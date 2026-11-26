import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BACKUP_CHUNK_BYTES, describeRestore } from '#lib/backup.js';
import { compareTags } from '#lib/client/tags/Tags.js';
import { restoreUpload } from '../backup';
import {
	downloadUrl,
	startDownload,
	startUpload,
	TRANSFER_MS,
	uploadUrl
} from '../backupTransfers';
import { origin } from './http';
import { loadNoteCrypto } from './crypto';
import { instructions } from './instructions';
import { markdownToHtml } from './markdown';
import { loadNotes, MCP_COLORS, type McpNote } from './notes';
import type { McpCaller } from './oauth';
import { describeScope } from './scope';
import { countBy, findNotes, queryWords } from './search';
import {
	createNote,
	editNote,
	noteShares,
	organizeNote,
	parseTagNames,
	setTrashed,
	shareNote,
	unshareNote,
	type Changed,
	type Outcome
} from './writes';

// The MCP server, with tools for the caller's notes: only the ones the user allowed the client
// (see `McpPermissions`), on the notes it may see (see `scope.ts`). A new one is made for every
// request, holding nothing but that caller, so nothing can carry over to another user.

const SNIPPET_LENGTH = 200;
const MAX_LIMIT = 50;

const color = z.enum(MCP_COLORS as [string, ...string[]]);

const summary = (note: McpNote) => ({
	id: note.id,
	title: note.title,
	snippet: note.markdown.slice(0, SNIPPET_LENGTH),
	tags: note.tags,
	color: note.color,
	archived: note.archived,
	trashed: note.trashed,
	hidden: note.hidden,
	created: note.createdAt.toISOString(),
	updated: note.updatedAt.toISOString(),
	shared_by: note.sharedBy
});

const noteFields = {
	id: z.string(),
	title: z.string().describe('The first line of the note'),
	tags: z.array(z.string()),
	color: color.describe('The note’s color, as the app names it'),
	archived: z.boolean().describe('Put away by the user, but kept'),
	trashed: z.boolean().describe('In the trash: deleted forever 30 days after it was put there'),
	hidden: z.boolean().describe('The app hides its text until the user opens it'),
	created: z.string().describe('ISO 8601'),
	updated: z.string().describe('ISO 8601: when its text or color last changed'),
	shared_by: z.string().nullable().describe('Who shared it with the user, or null if it’s theirs')
};
const noteSummary = z.object({
	...noteFields,
	snippet: z
		.string()
		.describe(`The start of the note as Markdown, up to ${SNIPPET_LENGTH} characters`)
});

const skipped = z
	.number()
	.describe('Notes that couldn’t be decrypted, and so are left out of every result');

/**
 * A tool result: as structured content, and as compact JSON text for clients that only read
 * text, as the MCP specification recommends. Compact, so the text isn't larger than it has to be.
 */
function result<T extends Record<string, unknown>>(value: T) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(value) }],
		structuredContent: value
	};
}

function failure(text: string) {
	return { isError: true, content: [{ type: 'text' as const, text }] };
}

/** A date for a filter, or null if it isn't one. Dates without a time are midnight UTC. */
function parseDate(value: string | undefined) {
	if (value === undefined) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
};

/** For tools that change notes; `destructive` for ones that can lose what was there. */
const changes = (destructive: boolean, idempotent = false) => ({
	readOnlyHint: false,
	destructiveHint: destructive,
	idempotentHint: idempotent,
	openWorldHint: false
});

/**
 * A shell command that uploads the zip at $FILE to an upload link, in pieces the server takes, each
 * at the offset it starts at. It stops at the first piece that fails.
 */
function uploadCommand(url: string) {
	return [
		'dir=$(mktemp -d)',
		`split -b ${BACKUP_CHUNK_BYTES} -a 4 "$FILE" "$dir/part-"`,
		'offset=0',
		'for part in "$dir"/part-*; do',
		`  curl -fsS -X PUT -H 'Content-Type: application/octet-stream' --data-binary @"$part" "${url}?offset=$offset" || break`,
		'  offset=$((offset + $(wc -c < "$part")))',
		'done',
		'rm -r "$dir"'
	].join('\n');
}

const MAX_MARKDOWN_LENGTH = 100_000;
const MAX_TAGS = 20;

export function createMcpServer(caller: McpCaller) {
	const { permissions } = caller.scope;
	// Decrypted when a tool first needs them, once per request, and gone after it. A change
	// forgets them, so later tools in the same request see it.
	let loaded: ReturnType<typeof loadNotes> | undefined;
	const load = () => (loaded ??= loadNotes(caller));
	const crypto = loadNoteCrypto();

	/** The result of a change: the note, if the app can still see it. */
	function changed(outcome: Outcome<Changed>, done: string) {
		loaded = undefined;
		if (!outcome.ok) return failure(outcome.message);
		const { note, inScope } = outcome.value;
		if (!inScope) {
			return result({
				id: note.id,
				in_reach: false,
				message: `${done} The note is now out of your reach, as the user chose, so you can’t see or change it any more.`
			});
		}
		return result({ id: note.id, in_reach: true, message: done, note: summary(note) });
	}

	/**
	 * Tag names from the app, checked, as tags the user has where they only differ in case: any
	 * of their tags, also of notes out of the app's reach, so it can't make a second "work" next
	 * to their "Work".
	 */
	async function tagNames(names: string[]) {
		if (names.length === 0) return parseTagNames(caller, names, []);
		return parseTagNames(caller, names, (await load()).allTagNames);
	}

	const server = new McpServer(
		{ name: 'plakkert', title: 'Plakkert notes', version: '1.2.0' },
		{ instructions: instructions(permissions, describeScope(caller.scope)) }
	);

	const changeResult = {
		id: z.string(),
		in_reach: z
			.boolean()
			.describe('Whether you can still see the note: the user may have left it out of your reach'),
		message: z.string(),
		note: noteSummary.optional().describe('The note after the change, while in reach')
	};
	const noteId = z.string().max(100).describe('The id from search_notes');

	if (permissions.read) registerReadTools();
	if (permissions.create) {
		server.registerTool(
			'create_note',
			{
				title: 'Create a note',
				description:
					'Creates a note for the user, from Markdown. Start it with a "# " heading as its ' +
					'title, like notes made in the app. It goes at the top of the user’s notes.',
				inputSchema: {
					markdown: z.string().max(MAX_MARKDOWN_LENGTH).describe('The whole note, as Markdown'),
					color: color.optional().describe('Defaults to yellow'),
					tags: z.array(z.string().max(100)).max(MAX_TAGS).default([]),
					archived: z.boolean().default(false).describe('Put it in the archive right away')
				},
				outputSchema: changeResult,
				annotations: changes(false)
			},
			async (input) => {
				const tags = await tagNames(input.tags);
				if (!tags.ok) return failure(tags.message);
				const outcome = createNote(await crypto, caller, {
					html: markdownToHtml(input.markdown),
					color: input.color,
					tags: tags.value,
					archived: input.archived
				});
				return changed(outcome, 'Created the note.');
			}
		);
	}
	if (permissions.edit) {
		server.registerTool(
			'edit_note',
			{
				title: 'Change a note’s text',
				description:
					'Replaces the whole text of a note with Markdown, or adds Markdown to its end. To ' +
					'change part of a note, read it with get_note first, and give all of it back with ' +
					'the change. Formatting Markdown doesn’t have, such as underlining, is lost when ' +
					'replacing. Notes in the trash, and notes shared with the user to view only, can’t ' +
					'be changed.',
				inputSchema: {
					id: noteId,
					markdown: z.string().max(MAX_MARKDOWN_LENGTH),
					append: z
						.boolean()
						.default(false)
						.describe('Add the Markdown to the end, rather than replacing the text')
				},
				outputSchema: changeResult,
				annotations: changes(true)
			},
			async ({ id, markdown, append }) =>
				changed(
					editNote(await crypto, caller, id, markdownToHtml(markdown), append),
					append ? 'Added to the note.' : 'Replaced the note’s text.'
				)
		);
	}
	if (permissions.delete) {
		server.registerTool(
			'delete_note',
			{
				title: 'Move a note to the trash',
				description:
					'Moves a note to the user’s trash, like deleting it in the app. It’s deleted for ' +
					'good after 30 days, unless restored with restore_note. A note shared with the user ' +
					'only leaves their notes; the owner keeps it.',
				inputSchema: { id: noteId },
				outputSchema: changeResult,
				annotations: changes(false, true)
			},
			async ({ id }) =>
				changed(setTrashed(await crypto, caller, id, true), 'Moved the note to the trash.')
		);
		server.registerTool(
			'restore_note',
			{
				title: 'Restore a note from the trash',
				description: 'Takes a note out of the trash, back to where it was.',
				inputSchema: { id: noteId },
				outputSchema: changeResult,
				annotations: changes(false, true)
			},
			async ({ id }) => changed(setTrashed(await crypto, caller, id, false), 'Restored the note.')
		);
	}
	if (permissions.organize) {
		server.registerTool(
			'organize_note',
			{
				title: 'Tag, color, archive or hide a note',
				description:
					'Changes how a note is organized: adds or removes tags, changes its color, ' +
					'archives or unarchives it, and hides or shows it (the app hides a hidden note’s ' +
					'text until it’s opened). Leave out what shouldn’t change. Tags are the user’s ' +
					'own, so this also works on notes shared with them, except for the color of ' +
					'notes shared to view only.',
				inputSchema: {
					id: noteId,
					add_tags: z.array(z.string().max(100)).max(MAX_TAGS).default([]),
					remove_tags: z.array(z.string().max(100)).max(MAX_TAGS).default([]),
					color: color.optional(),
					archived: z.boolean().optional(),
					hidden: z.boolean().optional()
				},
				outputSchema: changeResult,
				annotations: changes(false, true)
			},
			async (input) => {
				const nothing =
					input.add_tags.length === 0 &&
					input.remove_tags.length === 0 &&
					input.color === undefined &&
					input.archived === undefined &&
					input.hidden === undefined;
				if (nothing) return failure('Nothing to change: give tags, a color, archived or hidden.');
				const tags = await tagNames(input.add_tags);
				if (!tags.ok) return failure(tags.message);
				const outcome = organizeNote(await crypto, caller, input.id, {
					addTags: tags.value,
					removeTags: input.remove_tags,
					color: input.color,
					archived: input.archived,
					hidden: input.hidden
				});
				return changed(outcome, 'Changed the note.');
			}
		);
	}
	if (permissions.share) registerShareTools();
	if (permissions.backup) registerBackupTools();

	function registerBackupTools() {
		const expiresAt = () => new Date(Date.now() + TRANSFER_MS).toISOString();
		server.registerTool(
			'export_backup',
			{
				title: 'Back up all notes',
				description:
					'Gives a link to download a backup of all the user’s notes: a zip with everything of ' +
					'theirs on the server, still encrypted, to restore with start_backup_import and ' +
					'restore_backup. Download it with your own tools, e.g. the curl command given; the ' +
					'link works for 30 minutes. The backup can’t be read without the user’s password, ' +
					'but keep it as safe as the notes themselves.',
				inputSchema: {},
				outputSchema: { url: z.string(), expires_at: z.string(), command: z.string() },
				annotations: { ...READ_ONLY, idempotentHint: false }
			},
			async () => {
				const url = downloadUrl(origin(), startDownload(caller.userId, caller.grantId));
				const date = new Date().toISOString().slice(0, 10);
				return result({
					url,
					expires_at: expiresAt(),
					command: `curl -fsS -o plakkert-backup-${date}.zip '${url}'`
				});
			}
		);
		server.registerTool(
			'start_backup_import',
			{
				title: 'Start restoring a backup',
				description:
					'Gives a link to upload a backup zip to, made by export_backup or the app, before ' +
					`restore_backup. Upload it with your own tools, in pieces of at most ${BACKUP_CHUNK_BYTES} ` +
					'bytes, each with a PUT to the link with ?offset= the bytes sent before it, e.g. with ' +
					'the shell command given, after setting FILE to the zip’s path. The link works for 30 minutes.',
				inputSchema: {},
				outputSchema: {
					upload_id: z.string(),
					url: z.string(),
					chunk_size: z.number(),
					expires_at: z.string(),
					command: z.string()
				},
				annotations: { ...changes(false), openWorldHint: false }
			},
			async () => {
				const token = startUpload(caller.userId);
				const url = uploadUrl(origin(), token);
				return result({
					upload_id: token,
					url,
					chunk_size: BACKUP_CHUNK_BYTES,
					expires_at: expiresAt(),
					command: uploadCommand(url)
				});
			}
		);
		server.registerTool(
			'restore_backup',
			{
				title: 'Restore a backup',
				description:
					'Restores an uploaded backup into the user’s account, by merging: notes that are ' +
					'missing or were deleted come back, notes that are older than in the backup get its ' +
					'text (the text they had is kept in their history, if the user keeps history), and ' +
					'nothing is deleted. Only a backup of this same account can be restored. Only do this ' +
					'when the user asks.',
				inputSchema: { upload_id: z.string().min(1).max(100).describe('From start_backup_import') },
				outputSchema: {
					message: z.string(),
					restored: z.number(),
					updated: z.number(),
					retagged: z.number(),
					versions: z.number(),
					shares: z.number(),
					settings: z.boolean(),
					skipped_deleted: z
						.number()
						.describe('Notes that were deleted when the backup was made, and stay deleted')
				},
				annotations: changes(false, true)
			},
			async ({ upload_id }) => {
				loaded = undefined;
				const outcome = restoreUpload(upload_id, caller.userId);
				if (outcome.status !== 200) return failure(outcome.message);
				const { skippedDeleted, ...summary } = outcome.summary;
				return result({
					message: describeRestore(outcome.summary),
					...summary,
					skipped_deleted: skippedDeleted
				});
			}
		);
	}

	function registerShareTools() {
		const shares = {
			shares: z.array(z.object({ username: z.string(), permission: z.enum(['view', 'edit']) }))
		};
		const sharesResult = (outcome: Outcome<{ username: string; permission: 'view' | 'edit' }[]>) =>
			outcome.ok ? result({ shares: outcome.value }) : failure(outcome.message);
		server.registerTool(
			'list_shares',
			{
				title: 'See who a note is shared with',
				description: 'Lists the users one of the user’s own notes is shared with.',
				inputSchema: { id: noteId },
				outputSchema: shares,
				annotations: READ_ONLY
			},
			async ({ id }) => sharesResult(noteShares(await crypto, caller, id))
		);
		server.registerTool(
			'share_note',
			{
				title: 'Share a note',
				description:
					'Shares one of the user’s own notes with another Plakkert user, by username, to view ' +
					'or to edit, or changes what they may do with it. Only do this when the user asks: ' +
					'the other user can read the note right away.',
				inputSchema: {
					id: noteId,
					username: z.string().min(1).max(100),
					permission: z.enum(['view', 'edit']).default('view')
				},
				outputSchema: shares,
				annotations: changes(false, true)
			},
			async ({ id, username, permission }) =>
				sharesResult(shareNote(await crypto, caller, id, { username, permission }))
		);
		server.registerTool(
			'unshare_note',
			{
				title: 'Stop sharing a note',
				description: 'Stops sharing one of the user’s own notes with another user.',
				inputSchema: { id: noteId, username: z.string().min(1).max(100) },
				outputSchema: shares,
				annotations: changes(true, true)
			},
			async ({ id, username }) => sharesResult(unshareNote(await crypto, caller, id, username))
		);
	}

	function registerReadTools() {
		server.registerTool(
			'search_notes',
			{
				title: 'Search notes',
				description:
					'Finds the user’s notes and returns summaries (title, the start of the text, tags, ' +
					'color, dates, and whether each is archived, trashed, hidden or shared), a page at a ' +
					'time. Without a query, lists all notes that pass the filters. ' +
					'Matching: the query is split into words (letters and digits; punctuation and emoji ' +
					'are ignored), and a note matches when every word appears somewhere in its text or ' +
					'tags, also inside a longer word ("stamppot" finds "Boerenkoolstamppot"), ignoring ' +
					'case and accents. A query without letters or digits is refused. ' +
					'Results are sorted newest first by when they were last updated, unless sort or order ' +
					'say otherwise. When has_more is true, call again with offset set to next_offset.',
				inputSchema: {
					query: z
						.string()
						.max(200)
						.optional()
						.describe('Words that must all appear in the note’s text or tags'),
					tag: z.string().max(50).optional().describe('Only notes with this tag (any case)'),
					color: color.optional().describe('Only notes with this color'),
					include_archived: z.boolean().default(true),
					include_trashed: z.boolean().default(false),
					created_after: z
						.string()
						.optional()
						.describe('Only notes created at or after this ISO 8601 date or time (dates are UTC)'),
					created_before: z.string().optional().describe('Only notes created before this'),
					updated_after: z
						.string()
						.optional()
						.describe('Only notes last updated at or after this ISO 8601 date or time'),
					updated_before: z.string().optional().describe('Only notes last updated before this'),
					sort: z.enum(['updated', 'created']).default('updated'),
					order: z.enum(['newest', 'oldest']).default('newest'),
					limit: z.number().int().min(1).max(MAX_LIMIT).default(20),
					offset: z.number().int().min(0).default(0)
				},
				outputSchema: {
					total: z.number().describe('How many notes match, on all pages together'),
					offset: z.number(),
					notes: z.array(noteSummary),
					has_more: z.boolean(),
					next_offset: z.number().nullable().describe('The offset of the next page, if any'),
					skipped
				},
				annotations: READ_ONLY
			},
			async (input) => {
				const words = queryWords(input.query ?? '');
				if (input.query?.trim() && words.length === 0) {
					return failure(
						'The query has no letters or digits to search for. Leave it out to list all notes.'
					);
				}
				const dates = {
					createdAfter: parseDate(input.created_after),
					createdBefore: parseDate(input.created_before),
					updatedAfter: parseDate(input.updated_after),
					updatedBefore: parseDate(input.updated_before)
				};
				const invalid = Object.entries(dates).find(([, date]) => date === null);
				if (invalid) return failure(`${invalid[0]} isn’t a date. Use ISO 8601, e.g. 2026-11-20.`);

				const { notes, skippedIds } = await load();
				const found = findNotes(notes, {
					words,
					tag: input.tag,
					color: input.color,
					includeArchived: input.include_archived,
					includeTrashed: input.include_trashed,
					...(dates as Record<keyof typeof dates, Date | undefined>),
					sort: input.sort,
					order: input.order,
					limit: input.limit,
					offset: input.offset
				});
				return result({
					total: found.total,
					offset: input.offset,
					notes: found.page.map(summary),
					has_more: found.hasMore,
					next_offset: found.nextOffset,
					skipped: skippedIds.length
				});
			}
		);

		server.registerTool(
			'get_note',
			{
				title: 'Read a note',
				description:
					'Returns one whole note: its text as Markdown, with its title, tags, color, when it ' +
					'was created and last updated, and whether it’s archived, trashed, hidden or shared ' +
					'with the user. Takes an id from search_notes.',
				inputSchema: { id: z.string().max(100).describe('The id from search_notes') },
				outputSchema: {
					...noteFields,
					markdown: z.string().describe('The whole note'),
					can_edit: z
						.boolean()
						.describe('Whether the user may change its text: false for notes shared to view only'),
					owned: z.boolean().describe('Whether it’s the user’s own, so they can share it')
				},
				annotations: READ_ONLY
			},
			async ({ id }) => {
				const { notes, skippedIds } = await load();
				const note = notes.find((n) => n.id === id);
				if (!note) {
					return failure(
						skippedIds.includes(id)
							? `The note with id ${id} couldn't be decrypted, so it can't be read.`
							: `There's no note with id ${id}.`
					);
				}
				const { snippet: _, ...rest } = summary(note);
				void _;
				return result({
					...rest,
					markdown: note.markdown,
					can_edit: note.canEdit,
					owned: note.owned
				});
			}
		);

		server.registerTool(
			'list_tags',
			{
				title: 'List tags',
				description:
					'Lists the user’s tags, by name, with how many notes have each, not counting the ' +
					'trash. Use a name as search_notes’ tag filter.',
				inputSchema: {},
				outputSchema: {
					tags: z.array(z.object({ name: z.string(), count: z.number() })),
					skipped
				},
				annotations: READ_ONLY
			},
			async () => {
				const { notes, skippedIds } = await load();
				return result({
					tags: [...countBy(notes, (note) => note.tags)]
						.sort(([a], [b]) => compareTags(a, b))
						.map(([name, count]) => ({ name, count })),
					skipped: skippedIds.length
				});
			}
		);

		server.registerTool(
			'list_colors',
			{
				title: 'List colors',
				description:
					'Lists the colors the user’s notes have, with how many notes have each, not ' +
					'counting the trash. Users often group notes by color. Use a color as ' +
					'search_notes’ color filter.',
				inputSchema: {},
				outputSchema: {
					colors: z.array(z.object({ color, count: z.number() })),
					skipped
				},
				annotations: READ_ONLY
			},
			async () => {
				const { notes, skippedIds } = await load();
				const counts = countBy(notes, (note) => [note.color]);
				return result({
					colors: MCP_COLORS.filter((name) => counts.has(name)).map((name) => ({
						color: name,
						count: counts.get(name)!
					})),
					skipped: skippedIds.length
				});
			}
		);
	}

	return server;
}

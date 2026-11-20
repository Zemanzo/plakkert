import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compareTags } from '#lib/client/tags/Tags.js';
import { loadNotes, MCP_COLORS, type McpNote } from './notes';
import type { McpCaller } from './oauth';
import { countBy, findNotes, queryWords } from './search';

// The MCP server, with read-only tools for the caller's notes. A new one is made for every
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
	color: color.describe('The note’s colour, as the app names it'),
	archived: z.boolean().describe('Put away by the user, but kept'),
	trashed: z.boolean().describe('In the trash: deleted forever 30 days after it was put there'),
	hidden: z.boolean().describe('The app hides its text until the user opens it'),
	created: z.string().describe('ISO 8601'),
	updated: z.string().describe('ISO 8601: when its text or colour last changed'),
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

const INSTRUCTIONS = `The user's notes in Plakkert, an end-to-end encrypted notes app. Read only: you can search, read and summarise notes, but not create, change or delete them.

About the notes:
- Each note has a colour (${MCP_COLORS.join(', ')}), which users often use to group notes, e.g. red for grocery lists. search_notes can filter on it; list_colors shows which colours are used.
- Tags are the user's own labels; list_tags lists them. A note can have several.
- Archived notes are put away by the user but kept; search_notes includes them unless include_archived is false.
- Trashed notes are deleted forever 30 days after the user trashed them; search_notes leaves them out unless include_trashed is true.
- Hidden notes are ones the user hides in the app until opened, to keep them from people looking along. Be discreet with them.
- Notes shared with the user by someone else have shared_by set.
- Only what has synced to the server is here: changes made on a device that hasn't synced yet are missing. Notes imported from Google Keep keep their dates from Keep.
- A note that couldn't be decrypted is left out of every result; each result says how many with "skipped".

Use search_notes to find notes (it returns summaries), then get_note for a whole note.`;

export function createMcpServer(caller: McpCaller) {
	// Decrypted when a tool first needs them, once per request, and gone after it.
	let loaded: ReturnType<typeof loadNotes> | undefined;
	const load = () => (loaded ??= loadNotes(caller));

	const server = new McpServer(
		{ name: 'plakkert', title: 'Plakkert notes', version: '1.1.0' },
		{ instructions: INSTRUCTIONS }
	);

	server.registerTool(
		'search_notes',
		{
			title: 'Search notes',
			description:
				'Finds the user’s notes and returns summaries (title, the start of the text, tags, ' +
				'colour, dates, and whether each is archived, trashed, hidden or shared), a page at a ' +
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
				color: color.optional().describe('Only notes with this colour'),
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
				'Returns one whole note: its text as Markdown, with its title, tags, colour, when it ' +
				'was created and last updated, and whether it’s archived, trashed, hidden or shared ' +
				'with the user. Takes an id from search_notes.',
			inputSchema: { id: z.string().max(100).describe('The id from search_notes') },
			outputSchema: {
				...noteFields,
				markdown: z.string().describe('The whole note')
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
			return result({ ...rest, markdown: note.markdown });
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
			title: 'List colours',
			description:
				'Lists the colours the user’s notes have, with how many notes have each, not ' +
				'counting the trash. Users often group notes by colour. Use a colour as ' +
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

	return server;
}

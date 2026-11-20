import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { matchesSearch, parseSearchQuery } from '#lib/client/search/Search.js';
import { compareTags } from '#lib/client/tags/Tags.js';
import { loadNotes, type McpNote } from './notes';
import type { McpCaller } from './oauth';

// The MCP server, with read-only tools for the caller's notes. A new one is made for every
// request, holding nothing but that caller, so nothing can carry over to another user.

const SNIPPET_LENGTH = 200;

const summary = (note: McpNote) => ({
	id: note.id,
	title: note.title,
	snippet: note.markdown.slice(0, SNIPPET_LENGTH),
	tags: note.tags,
	archived: note.archived,
	trashed: note.trashed,
	hidden: note.hidden,
	updated: note.updatedAt.toISOString(),
	shared_by: note.sharedBy
});

const noteSummary = z.object({
	id: z.string(),
	title: z.string(),
	snippet: z.string().describe(`The start of the note, up to ${SNIPPET_LENGTH} characters`),
	tags: z.array(z.string()),
	archived: z.boolean(),
	trashed: z.boolean(),
	hidden: z.boolean().describe('Whether the user hides its text in the app until opened'),
	updated: z.string(),
	shared_by: z.string().nullable().describe('Who shared it with the user, if not their own')
});

/** A tool result, as text for clients that only read that, and as structured content. */
function result<T extends Record<string, unknown>>(value: T) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
		structuredContent: value
	};
}

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
};

export function createMcpServer(caller: McpCaller) {
	// Decrypted when a tool first needs them, once per request.
	let loaded: ReturnType<typeof loadNotes> | undefined;
	const notes = async () => (await (loaded ??= loadNotes(caller))).notes;

	const server = new McpServer(
		{ name: 'plakkert', title: 'Plakkert notes', version: '1.0.0' },
		{
			instructions:
				'The user’s notes in Plakkert, an end-to-end encrypted notes app. Read only: notes ' +
				'can be searched, read and listed by tag, but not changed. Notes in the trash are ' +
				'about to be deleted, and left out unless asked for.'
		}
	);

	server.registerTool(
		'search_notes',
		{
			title: 'Search notes',
			description:
				'Finds the user’s notes whose text or tags contain all words of the query, newest ' +
				'first. Without a query, lists all notes (optionally with a tag). Use get_note to ' +
				'read a whole note.',
			inputSchema: {
				query: z.string().max(200).optional().describe('Words that must all appear, any case'),
				tag: z.string().max(50).optional().describe('Only notes with this tag'),
				include_archived: z.boolean().default(true),
				include_trashed: z.boolean().default(false),
				limit: z.number().int().min(1).max(50).default(20),
				offset: z.number().int().min(0).default(0)
			},
			outputSchema: { total: z.number(), notes: z.array(noteSummary) },
			annotations: READ_ONLY
		},
		async ({ query, tag, include_archived, include_trashed, limit, offset }) => {
			const terms = parseSearchQuery(query ?? '');
			const tagName = tag?.trim().toLocaleLowerCase();
			const found = (await notes())
				.filter(
					(note) =>
						(include_archived || !note.archived) &&
						(include_trashed || !note.trashed) &&
						(!tagName || note.tags.some((t) => t.toLocaleLowerCase() === tagName)) &&
						matchesSearch(note.searchText, terms)
				)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
			return result({
				total: found.length,
				notes: found.slice(offset, offset + limit).map(summary)
			});
		}
	);

	server.registerTool(
		'get_note',
		{
			title: 'Read a note',
			description: 'Returns a whole note as Markdown, with its tags and dates.',
			inputSchema: { id: z.string().max(100).describe('The id from search_notes') },
			outputSchema: {
				...noteSummary.omit({ snippet: true }).shape,
				markdown: z.string(),
				color: z.string(),
				created: z.string()
			},
			annotations: READ_ONLY
		},
		async ({ id }) => {
			const note = (await notes()).find((n) => n.id === id);
			if (!note) {
				return {
					isError: true,
					content: [{ type: 'text' as const, text: `There's no note with id ${id}.` }]
				};
			}
			const { snippet: _, ...rest } = summary(note);
			void _;
			return result({
				...rest,
				markdown: note.markdown,
				color: note.color,
				created: note.createdAt.toISOString()
			});
		}
	);

	server.registerTool(
		'list_tags',
		{
			title: 'List tags',
			description: 'Lists the user’s tags, with how many notes have each, not counting the trash.',
			inputSchema: {},
			outputSchema: { tags: z.array(z.object({ name: z.string(), count: z.number() })) },
			annotations: READ_ONLY
		},
		async () => {
			const counts = new Map<string, number>();
			for (const note of await notes()) {
				for (const tag of note.tags) {
					counts.set(tag, (counts.get(tag) ?? 0) + (note.trashed ? 0 : 1));
				}
			}
			return result({
				tags: [...counts]
					.sort(([a], [b]) => compareTags(a, b))
					.map(([name, count]) => ({ name, count }))
			});
		}
	);

	return server;
}

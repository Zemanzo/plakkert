import { normalizeForSearch } from '#lib/client/search/Search.js';
import type { McpNote } from './notes';

// Searching, filtering, sorting and paging notes for the MCP tools. No database or crypto here, so
// it can be tested on its own. The app's own search (src/lib/client/search/) is left as it is.

/**
 * The words of a search query: runs of letters and digits, compared without case or accents.
 * Punctuation and emoji are left out, so "🧮- stamppot" searches for "stamppot", and "|" for
 * nothing at all.
 */
export function queryWords(query: string) {
	return normalizeForSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Whether a note has every word somewhere in its text or tags, also inside a longer word, so
 * "stamppot" finds "Boerenkoolstamppot". `searchText` is already normalized (see `loadNotes`).
 */
export const matchesWords = (searchText: string, words: readonly string[]) =>
	words.every((word) => searchText.includes(word));

export interface NoteQuery {
	words: string[];
	tag?: string;
	color?: string;
	includeArchived: boolean;
	includeTrashed: boolean;
	createdAfter?: Date;
	createdBefore?: Date;
	updatedAfter?: Date;
	updatedBefore?: Date;
	sort: 'updated' | 'created';
	order: 'newest' | 'oldest';
	limit: number;
	offset: number;
}

/** The notes that match, sorted, and the page asked for. */
export function findNotes(notes: readonly McpNote[], query: NoteQuery) {
	const tag = query.tag?.trim().toLocaleLowerCase();
	const time = (note: McpNote) =>
		(query.sort === 'created' ? note.createdAt : note.updatedAt).getTime();
	const found = notes
		.filter(
			(note) =>
				(query.includeArchived || !note.archived) &&
				(query.includeTrashed || !note.trashed) &&
				(!tag || note.tags.some((t) => t.toLocaleLowerCase() === tag)) &&
				(!query.color || note.color === query.color) &&
				(!query.createdAfter || note.createdAt >= query.createdAfter) &&
				(!query.createdBefore || note.createdAt < query.createdBefore) &&
				(!query.updatedAfter || note.updatedAt >= query.updatedAfter) &&
				(!query.updatedBefore || note.updatedAt < query.updatedBefore) &&
				matchesWords(note.searchText, query.words)
		)
		.sort((a, b) => (query.order === 'newest' ? time(b) - time(a) : time(a) - time(b)));
	const page = found.slice(query.offset, query.offset + query.limit);
	const end = query.offset + page.length;
	return {
		total: found.length,
		page,
		hasMore: end < found.length,
		nextOffset: end < found.length ? end : null
	};
}

/** How many notes there are per value, e.g. per tag, not counting the trash. */
export function countBy(notes: readonly McpNote[], values: (note: McpNote) => readonly string[]) {
	const counts = new Map<string, number>();
	for (const note of notes) {
		for (const value of values(note)) {
			counts.set(value, (counts.get(value) ?? 0) + (note.trashed ? 0 : 1));
		}
	}
	return counts;
}

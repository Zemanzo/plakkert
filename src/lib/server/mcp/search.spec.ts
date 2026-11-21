import { describe, expect, it } from 'vitest';
import { buildSearchText, htmlToText, normalizeForSearch } from '#lib/client/search/Search.js';
import type { McpNote } from './notes';
import { countBy, findNotes, matchesWords, queryWords, type NoteQuery } from './search';

const searchTextOf = (html: string, tags: string[] = []) =>
	buildSearchText(normalizeForSearch(htmlToText(html)), tags);

let id = 0;
const note = (extra: Partial<McpNote> = {}): McpNote => ({
	id: String(++id),
	title: 'Note',
	markdown: 'Note',
	searchText: searchTextOf('<p>Note</p>'),
	tags: [],
	color: 'yellow',
	archived: false,
	trashed: false,
	hidden: false,
	createdAt: new Date('2026-01-01'),
	updatedAt: new Date('2026-01-01'),
	sharedBy: null,
	canEdit: true,
	owned: true,
	...extra
});

const query = (extra: Partial<NoteQuery> = {}): NoteQuery => ({
	words: [],
	includeArchived: true,
	includeTrashed: false,
	sort: 'updated',
	order: 'newest',
	limit: 20,
	offset: 0,
	...extra
});

describe('query words', () => {
	it('are letters and digits, without case or accents', () => {
		expect(queryWords('Café  Crème 2026')).toEqual(['cafe', 'creme', '2026']);
		expect(queryWords('to-do: milk!')).toEqual(['to', 'do', 'milk']);
	});

	it('leave out punctuation and emoji, so these find nothing to search for', () => {
		expect(queryWords('|')).toEqual([]);
		expect(queryWords('🧮 - !')).toEqual([]);
		expect(queryWords('🧮- Boerenkoolstamppot')).toEqual(['boerenkoolstamppot']);
	});
});

describe('matching', () => {
	const title = searchTextOf('<h1>🧮- Boerenkoolstamppot</h1><p>Met rookworst</p>', ['Recepten']);

	it('finds a word in a title next to emoji and punctuation', () => {
		expect(matchesWords(title, queryWords('Boerenkoolstamppot'))).toBe(true);
		expect(matchesWords(title, queryWords('boerenkool stamppot'))).toBe(true);
	});

	it('finds words inside longer words, and in tags, but needs all of them', () => {
		expect(matchesWords(title, queryWords('stamppot'))).toBe(true);
		expect(matchesWords(title, queryWords('recepten rookworst'))).toBe(true);
		expect(matchesWords(title, queryWords('stamppot spinazie'))).toBe(false);
	});
});

describe('finding notes', () => {
	const red = note({
		color: 'red',
		createdAt: new Date('2026-03-01'),
		updatedAt: new Date('2026-03-05')
	});
	const old = note({ createdAt: new Date('2025-06-01'), updatedAt: new Date('2026-04-01') });
	const archived = note({ archived: true, createdAt: new Date('2026-02-01') });
	const trashed = note({ trashed: true, color: 'red' });
	const notes = [red, old, archived, trashed];
	const ids = (result: ReturnType<typeof findNotes>) => result.page.map((n) => n.id);

	it('filters on colour, archive and trash', () => {
		expect(ids(findNotes(notes, query({ color: 'red' })))).toEqual([red.id]);
		expect(ids(findNotes(notes, query({ color: 'red', includeTrashed: true }))).sort()).toEqual(
			[red.id, trashed.id].sort()
		);
		expect(ids(findNotes(notes, query({ includeArchived: false })))).not.toContain(archived.id);
	});

	it('sorts by when notes were updated or created, either way', () => {
		expect(ids(findNotes(notes, query()))).toEqual([old.id, red.id, archived.id]);
		expect(ids(findNotes(notes, query({ sort: 'created' })))).toEqual([
			red.id,
			archived.id,
			old.id
		]);
		expect(ids(findNotes(notes, query({ sort: 'created', order: 'oldest' })))).toEqual([
			old.id,
			archived.id,
			red.id
		]);
	});

	it('filters on dates, from the first moment up to but not including the last', () => {
		const result = findNotes(
			notes,
			query({ createdAfter: new Date('2026-01-01'), createdBefore: new Date('2026-03-01') })
		);
		expect(ids(result)).toEqual([archived.id]);
		expect(ids(findNotes(notes, query({ updatedAfter: new Date('2026-04-01') })))).toEqual([
			old.id
		]);
		expect(ids(findNotes(notes, query({ updatedBefore: new Date('2026-01-02') })))).toEqual([
			archived.id
		]);
	});

	it('pages, saying whether there is more and where it starts', () => {
		const first = findNotes(notes, query({ limit: 2 }));
		expect(first).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });
		const last = findNotes(notes, query({ limit: 2, offset: 2 }));
		expect(last).toMatchObject({ total: 3, hasMore: false, nextOffset: null });
		expect(last.page).toHaveLength(1);
		expect(findNotes(notes, query({ offset: 10 }))).toMatchObject({
			hasMore: false,
			nextOffset: null
		});
	});

	it('counts per value, not counting the trash', () => {
		expect(countBy(notes, (n) => [n.color])).toEqual(
			new Map([
				['red', 1],
				['yellow', 2]
			])
		);
	});
});

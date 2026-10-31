import { describe, expect, it } from 'vitest';
import { buildSearchText, normalizeForSearch, parseSearchQuery } from '../search/Search';
import { ARCHIVED_TAG, TRASHED_TAG, userTags, type NoteTags } from '../tags/Tags';
import { selectNotes, type NotesViewKind } from './Views';

function entry(id: string, createdAt: number, tags: NoteTags = {}) {
	return {
		id,
		note: { createdAt: new Date(createdAt) },
		tags,
		searchText: buildSearchText(normalizeForSearch(`note ${id}`), userTags(tags))
	};
}

const entries = [
	entry('plain', 1),
	entry('newer', 2),
	entry('work', 3, { work: 1 }),
	entry('archived-work', 4, { work: 1, [ARCHIVED_TAG]: 10 }),
	entry('archived-later', 5, { [ARCHIVED_TAG]: 20 }),
	entry('trashed-work', 6, { work: 1, [TRASHED_TAG]: 30 }),
	entry('trashed-later', 7, { [ARCHIVED_TAG]: 1, [TRASHED_TAG]: 40 })
];

const ids = (list: { id: string }[]) => list.map((item) => item.id);
const select = (view: NotesViewKind, query = '') =>
	selectNotes(entries as never[], view, parseSearchQuery(query)) as unknown as {
		main: { id: string }[];
		archived: { id: string }[];
		trashedMatches: number;
	};

describe('selectNotes', () => {
	it('shows current notes, newest first, without archived or trashed ones', () => {
		const { main, archived, trashedMatches } = select({ kind: 'notes' });
		expect(ids(main)).toEqual(['work', 'newer', 'plain']);
		expect(archived).toEqual([]);
		expect(trashedMatches).toBe(0);
	});

	it('shows notes with a tag, with archived ones apart', () => {
		const { main, archived } = select({ kind: 'tag', tag: 'work' });
		expect(ids(main)).toEqual(['work']);
		expect(ids(archived)).toEqual(['archived-work']);
	});

	it('shows the archive, most recently archived first', () => {
		expect(ids(select({ kind: 'archive' }).main)).toEqual(['archived-later', 'archived-work']);
	});

	it('shows the trash, most recently trashed first, including trashed archived notes', () => {
		expect(ids(select({ kind: 'trash' }).main)).toEqual(['trashed-later', 'trashed-work']);
	});

	it('searches within the view, and also lists matching archived notes', () => {
		const { main, archived, trashedMatches } = select({ kind: 'notes' }, 'work');
		expect(ids(main)).toEqual(['work']);
		expect(ids(archived)).toEqual(['archived-work']);
		expect(trashedMatches).toBe(1);
	});

	it('searches the trash', () => {
		expect(ids(select({ kind: 'trash' }, 'later').main)).toEqual(['trashed-later']);
	});
});

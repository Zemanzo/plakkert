import { matchesSearch } from '../search/Search';
import { ARCHIVED_TAG, hasTag, isArchived, isTrashed, TRASHED_TAG } from '../tags/Tags';
import type { NoteEntry } from './NoteStore.svelte';

/** Which notes are shown: all current notes, those with a tag, the archive or the trash. */
export type NotesViewKind =
	{ kind: 'notes' } | { kind: 'tag'; tag: string } | { kind: 'archive' } | { kind: 'trash' };

export interface ViewSelection<T = NoteEntry> {
	/** The notes the view is about. */
	main: T[];
	/**
	 * Archived notes that also match, shown below the main notes: the archived
	 * notes with the tag, or the archived notes that match a search.
	 */
	archived: T[];
	/** How many notes in the trash match the search, which the view doesn't show. */
	trashedMatches: number;
}

type Entry = Pick<NoteEntry, 'note' | 'tags' | 'searchText'>;

const byNewest = (a: Entry, b: Entry) => b.note.createdAt.getTime() - a.note.createdAt.getTime();
/** Sorts by when a tag was added, e.g. most recently archived first. */
const byTagAddedAt = (tag: string) => (a: Entry, b: Entry) =>
	(b.tags[tag] ?? 0) - (a.tags[tag] ?? 0) || byNewest(a, b);

/**
 * Picks the notes to show for a view and search. Search terms must already be
 * parsed with `parseSearchQuery`.
 */
export function selectNotes<T extends Entry>(
	entries: T[],
	view: NotesViewKind,
	terms: string[]
): ViewSelection<T> {
	const searching = terms.length > 0;
	const inView = (entry: T) =>
		(view.kind !== 'tag' || hasTag(entry.tags, view.tag)) && matchesSearch(entry.searchText, terms);
	const trashed = entries.filter((entry) => isTrashed(entry.tags) && inView(entry));

	if (view.kind === 'trash') {
		return { main: trashed.sort(byTagAddedAt(TRASHED_TAG)), archived: [], trashedMatches: 0 };
	}

	const current = entries.filter((entry) => !isTrashed(entry.tags) && inView(entry));
	const archived = current.filter((entry) => isArchived(entry.tags));
	const trashedMatches = searching ? trashed.length : 0;

	if (view.kind === 'archive') {
		return { main: archived.sort(byTagAddedAt(ARCHIVED_TAG)), archived: [], trashedMatches };
	}

	return {
		main: current.filter((entry) => !isArchived(entry.tags)).sort(byNewest),
		archived: view.kind === 'tag' || searching ? archived.sort(byTagAddedAt(ARCHIVED_TAG)) : [],
		trashedMatches
	};
}

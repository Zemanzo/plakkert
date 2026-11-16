import type { NewNote } from '../note/NotesCRUD';
import {
	ARCHIVED_TAG,
	compareTags,
	MAX_TAG_LENGTH,
	normalizeTagName,
	validateTagName,
	type NoteTags
} from '../tags/Tags';
import type { ImportSource, ParseResult } from '.';

export interface ImportLabel {
	/** As the tag will be named: the existing tag's name, if there is one. */
	name: string;
	/** How many of the imported notes get it. */
	notes: number;
	isNewTag: boolean;
}

/** What an import will do, shown to the user to confirm it. */
export interface ImportPlan {
	source: ImportSource;
	/** The notes to save, with their tags. */
	notes: NewNote[];
	archived: number;
	/** The labels that become tags, sorted by name. Not the source's own tag. */
	labels: ImportLabel[];
	/** Notes that were imported before, which are skipped. */
	duplicates: number;
	/** Notes that were in the trash, which aren't imported. */
	trashed: number;
	/** Names of the files that couldn't be read as a note. */
	failed: string[];
}

/** Makes a tag name of a label, or returns null if it can't be one, e.g. one starting with "$". */
function labelToTag(label: string) {
	const name = normalizeTagName(label).slice(0, MAX_TAG_LENGTH).trim();
	return validateTagName(name) ? null : name;
}

/**
 * Works out what an import will do. Labels become tags, joining existing tags
 * that only differ in case, as when adding a tag by hand.
 *
 * A note was imported before when one of the user's notes was created at the
 * very same millisecond: imported notes keep the date they were created, and
 * the user can't have made another note at exactly that time. That still
 * holds after they edited it.
 *
 * @param existingTags The names of the user's tags.
 * @param existingCreatedAt When the user's notes were created, in milliseconds since the epoch.
 */
export function planImport(
	source: ImportSource,
	{ notes, trashed, failed }: ParseResult,
	existingTags: Iterable<string>,
	existingCreatedAt: Set<number>,
	now = Date.now()
): ImportPlan {
	// Tag names by their lower case, to merge labels into existing tags.
	const tagNames = new Map<string, string>();
	for (const tag of existingTags) tagNames.set(tag.toLocaleLowerCase(), tag);
	const existing = new Set(tagNames.values());
	const tagFor = (name: string) => {
		const key = name.toLocaleLowerCase();
		if (!tagNames.has(key)) tagNames.set(key, name);
		return tagNames.get(key)!;
	};
	const sourceTag = tagFor(source.tag);

	const labelCounts = new Map<string, number>();
	const newNotes: NewNote[] = [];
	let archived = 0;
	for (const note of notes) {
		if (existingCreatedAt.has(note.createdAt)) continue;

		const tags: NoteTags = { [sourceTag]: now };
		for (const label of note.labels) {
			const name = labelToTag(label);
			if (!name) continue;
			const tag = tagFor(name);
			if (tag === sourceTag || tags[tag]) continue;
			tags[tag] = now;
			labelCounts.set(tag, (labelCounts.get(tag) ?? 0) + 1);
		}
		if (note.archived) {
			tags[ARCHIVED_TAG] = now;
			archived++;
		}

		newNotes.push({
			data: { content: note.content, meta: { color: note.color } },
			tags,
			createdAt: new Date(note.createdAt),
			updatedAt: new Date(note.updatedAt)
		});
	}

	return {
		source,
		notes: newNotes,
		archived,
		labels: [...labelCounts]
			.map(([name, count]) => ({ name, notes: count, isNewTag: !existing.has(name) }))
			.sort((a, b) => compareTags(a.name, b.name)),
		duplicates: notes.length - newNotes.length,
		trashed,
		failed
	};
}

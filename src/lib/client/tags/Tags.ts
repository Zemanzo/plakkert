/**
 * The tags a user gave a note, mapped to when each was added (milliseconds
 * since the epoch). Tags are per user: everyone a note is shared with
 * organises it their own way.
 *
 * Archiving and trashing a note are special tags as well. They start with a
 * `$`, which tags typed by the user can't.
 */
export type NoteTags = Record<string, number>;

export const ARCHIVED_TAG = '$archived';
export const TRASHED_TAG = '$trashed';

/** How long a note stays in the trash before it is deleted for good. */
export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const MAX_TAG_LENGTH = 50;

export const isSystemTag = (tag: string) => tag.startsWith('$');

/** Trims a tag name and collapses whitespace, so " to  do " and "to do" are the same tag. */
export function normalizeTagName(name: string) {
	return name.trim().replace(/\s+/g, ' ');
}

/** Returns why a (normalized) tag name can't be used, or null if it can. */
export function validateTagName(name: string): string | null {
	if (!name) return 'Enter a name for the tag.';
	if (isSystemTag(name)) return 'Tags can’t start with “$”.';
	if (name.length > MAX_TAG_LENGTH) return `Tags can be at most ${MAX_TAG_LENGTH} characters.`;
	return null;
}

/**
 * Finds a tag in `existing` that only differs from `name` in case, so adding
 * "work" to a note reuses an existing "Work" tag rather than creating a second one.
 */
export function findExistingTag(existing: Iterable<string>, name: string) {
	const lowerCaseName = name.toLocaleLowerCase();
	for (const tag of existing) {
		if (tag.toLocaleLowerCase() === lowerCaseName) return tag;
	}
	return undefined;
}

export function compareTags(a: string, b: string) {
	return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** The tags the user added themselves, sorted by name. */
export function userTags(tags: NoteTags) {
	return Object.keys(tags)
		.filter((tag) => !isSystemTag(tag))
		.sort(compareTags);
}

export function hasTag(tags: NoteTags, tag: string) {
	return Object.hasOwn(tags, tag);
}

/** Adds a tag. A tag the note already has keeps its original time. */
export function withTag(tags: NoteTags, tag: string, now = Date.now()): NoteTags {
	return hasTag(tags, tag) ? tags : { ...tags, [tag]: now };
}

export function withoutTag(tags: NoteTags, tag: string): NoteTags {
	if (!hasTag(tags, tag)) return tags;
	const rest = { ...tags };
	delete rest[tag];
	return rest;
}

/** Renames a tag, merging it into the new name if the note already has that tag. */
export function withRenamedTag(tags: NoteTags, from: string, to: string): NoteTags {
	if (!hasTag(tags, from) || from === to) return tags;
	const addedAt = Math.min(tags[from], tags[to] ?? Infinity);
	return { ...withoutTag(tags, from), [to]: addedAt };
}

export const isArchived = (tags: NoteTags) => hasTag(tags, ARCHIVED_TAG);
export const isTrashed = (tags: NoteTags) => hasTag(tags, TRASHED_TAG);

/** When a trashed note will be deleted for good, or null if it isn't in the trash. */
export function trashExpiresAt(tags: NoteTags) {
	return isTrashed(tags) ? new Date(tags[TRASHED_TAG] + TRASH_RETENTION_MS) : null;
}

export function isTrashExpired(tags: NoteTags, now = Date.now()) {
	const expiresAt = trashExpiresAt(tags);
	return expiresAt !== null && expiresAt.getTime() <= now;
}

/** Whole days left before a trashed note is deleted for good, rounded up. */
export function daysUntilDeleted(tags: NoteTags, now = Date.now()) {
	const expiresAt = trashExpiresAt(tags);
	if (!expiresAt) return null;
	return Math.max(0, Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));
}

/**
 * Validates tags that were decrypted from storage, dropping anything that
 * isn't a tag name with a time, so a corrupt entry can't break the app.
 */
export function parseTags(value: unknown): NoteTags {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	const tags: NoteTags = {};
	for (const [tag, addedAt] of Object.entries(value)) {
		if (typeof addedAt === 'number' && Number.isFinite(addedAt) && tag) {
			tags[tag] = addedAt;
		}
	}
	return tags;
}

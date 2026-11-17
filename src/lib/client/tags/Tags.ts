/**
 * The tags a user gave a note, mapped to when each was added (milliseconds
 * since the epoch). Tags are per user: everyone a note is shared with
 * organises it their own way.
 *
 * Archiving and trashing a note are special tags as well. They start with a
 * `$`, which tags typed by the user can't. So is the note's place in the
 * user's own order, `$position`, whose value is a sort key rather than a time.
 * A note whose text is hidden while it's closed has `$hidden`, and the message
 * shown in its place, if any, is the rest of a tag starting with
 * `$hiddenMessage:`. It's kept when the note is shown again, for if it's hidden
 * again later.
 */
export type NoteTags = Record<string, number>;

export const ARCHIVED_TAG = '$archived';
export const TRASHED_TAG = '$trashed';
export const POSITION_TAG = '$position';
export const HIDDEN_TAG = '$hidden';
const HIDDEN_MESSAGE_PREFIX = '$hiddenMessage:';

export const MAX_HIDDEN_MESSAGE_LENGTH = 100;

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

/**
 * Compares tag names by the user's own order (from their synced settings):
 * the tags in `order` first, in that order, then any others by name.
 */
export function tagOrderComparator(order: readonly string[]) {
	const positions = new Map(order.map((tag, index) => [tag, index]));
	return (a: string, b: string) => {
		const positionA = positions.get(a) ?? order.length;
		const positionB = positions.get(b) ?? order.length;
		return positionA - positionB || compareTags(a, b);
	};
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

/**
 * Renames and removes several tags at once: each tag in `changes` gets the
 * new name, or is removed when that is null. Unlike renaming them one by one,
 * this can swap two names. Tags that end up with the same name are merged,
 * keeping the earliest time they were added.
 */
export function withChangedTags(
	tags: NoteTags,
	changes: ReadonlyMap<string, string | null>
): NoteTags {
	if (!Object.keys(tags).some((tag) => changes.has(tag))) return tags;
	const result: NoteTags = {};
	for (const [tag, addedAt] of Object.entries(tags)) {
		const name = changes.has(tag) ? changes.get(tag)! : tag;
		if (name === null) continue;
		result[name] = Math.min(addedAt, result[name] ?? Infinity);
	}
	return result;
}

export const isArchived = (tags: NoteTags) => hasTag(tags, ARCHIVED_TAG);
export const isTrashed = (tags: NoteTags) => hasTag(tags, TRASHED_TAG);
export const isHidden = (tags: NoteTags) => hasTag(tags, HIDDEN_TAG);

/** The message shown in place of the note's text while it's hidden, or '' if there is none. */
export function hiddenMessage(tags: NoteTags) {
	const tag = Object.keys(tags).find((tag) => tag.startsWith(HIDDEN_MESSAGE_PREFIX));
	return tag?.slice(HIDDEN_MESSAGE_PREFIX.length) ?? '';
}

/** Sets the message shown in place of a hidden note's text, or removes it when empty. */
export function withHiddenMessage(tags: NoteTags, message: string, now = Date.now()): NoteTags {
	const normalized = normalizeTagName(message).slice(0, MAX_HIDDEN_MESSAGE_LENGTH);
	if (normalized === hiddenMessage(tags)) return tags;
	const result = Object.fromEntries(
		Object.entries(tags).filter(([tag]) => !tag.startsWith(HIDDEN_MESSAGE_PREFIX))
	);
	if (normalized) result[HIDDEN_MESSAGE_PREFIX + normalized] = now;
	return result;
}

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

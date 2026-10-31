import { db } from '../Database';
import { decryptTags, encryptTags } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import type { NoteTags } from './Tags';

/**
 * Replaces the user's tags for a note. Like note edits, this is written to
 * IndexedDB first and synced in the background, so it also works offline.
 *
 * @param noteKey The decrypted key of the note, which the tags are encrypted with.
 */
export async function saveTags(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	tags: NoteTags,
	updatedAt = new Date()
) {
	const encryptedTags = await encryptTags(tags, noteKey);
	await db.noteKeys
		.where({ noteId, userId })
		.modify({ tags: encryptedTags, tagsUpdatedAt: updatedAt, tagsDirty: 1 });
	syncEngine.requestSync();
}

/** Reads the user's current tags for a note from IndexedDB. */
export async function loadTags(noteId: string, userId: string, noteKey: Uint8Array) {
	const row = await db.noteKeys.where({ noteId, userId }).first();
	return row?.tags ? decryptTags(row.tags, noteKey) : {};
}

/** Pending tag updates per note, so quick successive changes build on each other. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Changes the user's tags for a note, based on the tags as currently stored
 * rather than on what is shown, which may lag behind (e.g. right after sync).
 * Updates to the same note run one after another.
 *
 * @returns The tags before and after the change.
 */
export function updateTags(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	update: (tags: NoteTags) => NoteTags
) {
	const run = async () => {
		const before = await loadTags(noteId, userId, noteKey);
		const after = update(before);
		if (after !== before) {
			await saveTags(noteId, userId, noteKey, after);
		}
		return { before, after };
	};
	const key = `${userId}/${noteId}`;
	const result = (queues.get(key) ?? Promise.resolve()).then(run);
	// Failures are reported to the caller through `result`; the queue just moves on.
	const settled = result
		.finally(() => {
			if (queues.get(key) === settled) queues.delete(key);
		})
		.catch(() => {});
	queues.set(key, settled);
	return result;
}

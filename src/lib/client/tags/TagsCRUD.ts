import { db } from '../Database';
import { encryptTags } from '../serialization/Serialize';
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

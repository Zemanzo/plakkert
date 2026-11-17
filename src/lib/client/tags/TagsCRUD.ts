import { db } from '../Database';
import {
	decryptNoteKey,
	decryptNoteUserData,
	decryptTags,
	encryptTags
} from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import type { RuntimeUser } from '#lib/types.js';
import { normalizeHiddenMessage, userTags, type NoteTags, type NoteUserData } from './Tags';

/**
 * The names of all the user's own tags, read straight from the database, for
 * where the notes aren't loaded, such as the settings.
 */
export async function loadTagNames(
	user: Pick<RuntimeUser, 'id' | 'publicKeyUint8' | 'decodedPrivateKey'>
) {
	const rows = await db.noteKeys.where({ userId: user.id }).toArray();
	const names = new Set<string>();
	await Promise.all(
		rows.map(async ({ encryptedKey, tags }) => {
			if (!tags) return;
			try {
				const noteKey = await decryptNoteKey(
					encryptedKey,
					user.publicKeyUint8,
					user.decodedPrivateKey
				);
				for (const tag of userTags(await decryptTags(tags, noteKey))) names.add(tag);
			} catch (error) {
				// The notes view leaves out these tags as well.
				console.warn('Could not read the tags of a note', error);
			}
		})
	);
	return names;
}

/**
 * Replaces the user's tags and message for a note. Like note edits, this is
 * written to IndexedDB first and synced in the background, so it also works
 * offline.
 *
 * @param noteKey The decrypted key of the note, which the tags are encrypted with.
 */
async function saveNoteUserData(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	{ tags, hiddenMessage }: NoteUserData
) {
	const encryptedTags = await encryptTags(tags, noteKey, hiddenMessage);
	await db.noteKeys
		.where({ noteId, userId })
		.modify({ tags: encryptedTags, tagsUpdatedAt: new Date(), tagsDirty: 1 });
	syncEngine.requestSync();
}

/**
 * Changes the user's tags on many notes at once, e.g. renaming a tag on every
 * note that has it. Like `updateTags`, it builds on the tags as stored. They
 * are all written in one transaction, as every write updates the notes that
 * are shown, which would take long for hundreds of notes one by one.
 *
 * @param noteKeys The decrypted key of every note to change, by note id.
 */
export async function updateTagsOfNotes(
	userId: string,
	noteKeys: ReadonlyMap<string, Uint8Array>,
	update: (tags: NoteTags) => NoteTags
) {
	const rows = await db.noteKeys
		.where('[noteId+userId]')
		.anyOf([...noteKeys.keys()].map((noteId) => [noteId, userId]))
		.toArray();
	const updatedAt = new Date();
	const changed = (
		await Promise.all(
			rows.map(async (row) => {
				const noteKey = noteKeys.get(row.noteId)!;
				const data = row.tags ? await decryptNoteUserData(row.tags, noteKey) : noUserData;
				const after = update(data.tags);
				if (after === data.tags) return [];
				const encryptedTags = await encryptTags(after, noteKey, data.hiddenMessage);
				return [{ row, noteKey, encryptedTags }];
			})
		)
	).flat();

	const conflicts: typeof changed = [];
	await db.transaction('rw', db.noteKeys, async () => {
		for (const change of changed) {
			const { noteId } = change.row;
			const current = await db.noteKeys.where({ noteId, userId }).first();
			// Changed in the meantime, e.g. by sync: done again below, on the tags as they are now.
			if (current?.tagsUpdatedAt?.getTime() !== change.row.tagsUpdatedAt?.getTime()) {
				conflicts.push(change);
				continue;
			}
			await db.noteKeys
				.where({ noteId, userId })
				.modify({ tags: change.encryptedTags, tagsUpdatedAt: updatedAt, tagsDirty: 1 });
		}
	});
	for (const { row, noteKey } of conflicts) {
		await updateTags(row.noteId, userId, noteKey, update);
	}
	syncEngine.requestSync();
}

const noUserData: NoteUserData = { tags: {}, hiddenMessage: '' };

/** Reads the user's current tags and message for a note from IndexedDB. */
async function loadNoteUserData(noteId: string, userId: string, noteKey: Uint8Array) {
	const row = await db.noteKeys.where({ noteId, userId }).first();
	return row?.tags ? decryptNoteUserData(row.tags, noteKey) : noUserData;
}

/** Reads the user's current tags for a note from IndexedDB. */
export async function loadTags(noteId: string, userId: string, noteKey: Uint8Array) {
	return (await loadNoteUserData(noteId, userId, noteKey)).tags;
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
export async function updateTags(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	update: (tags: NoteTags) => NoteTags
) {
	const { before, after } = await updateNoteUserData(noteId, userId, noteKey, (data) => {
		const tags = update(data.tags);
		return tags === data.tags ? data : { ...data, tags };
	});
	return { before: before.tags, after: after.tags };
}

/** Changes the message shown in place of a hidden note's text, like `updateTags`. */
export function updateHiddenMessage(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	message: string
) {
	return updateNoteUserData(noteId, userId, noteKey, (data) => {
		const hiddenMessage = normalizeHiddenMessage(message);
		return hiddenMessage === data.hiddenMessage ? data : { ...data, hiddenMessage };
	});
}

/** Changes the user's tags and message for a note, one update after another. */
function updateNoteUserData(
	noteId: string,
	userId: string,
	noteKey: Uint8Array,
	update: (data: NoteUserData) => NoteUserData
) {
	const run = async () => {
		const before = await loadNoteUserData(noteId, userId, noteKey);
		const after = update(before);
		if (after !== before) {
			await saveNoteUserData(noteId, userId, noteKey, after);
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

import { db, type NoteData, type NoteKey, type Note as NoteType } from '../Database';
import { encryptNote, encryptTags, getNoteKey } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import type { NoteTags } from '../tags/Tags';
import { DEFAULT_NOTE_COLOR } from './NoteColors';
import type { RuntimeUser } from '#lib/types.js';

// Notes are only written to IndexedDB here, and marked dirty. The sync engine sends them to the
// server in the background, so all of this also works offline.

/** Only the user's id and public key are needed to add notes. */
type NoteOwner = Pick<RuntimeUser, 'id' | 'publicKeyUint8'>;

export interface NewNote {
	data: NoteData;
	/** Tags to give the note right away, e.g. the tag that is being viewed. */
	tags?: NoteTags;
	/** Defaults to now. Imported notes keep when they were written. */
	createdAt?: Date;
	/** Defaults to `createdAt`. */
	updatedAt?: Date;
}

/**
 * Adds notes for the given user, all in one transaction. Generates a new note
 * key for each, encrypts the notes, and stores both the notes and the
 * encrypted keys in the database.
 *
 * @returns The IDs of the new notes, in the same order.
 */
export async function createNotes(user: NoteOwner, newNotes: NewNote[]) {
	const now = new Date();
	const records = await Promise.all(
		newNotes.map(async ({ data, tags, createdAt = now, updatedAt = createdAt }) => {
			const { noteKey, encryptedKey } = await getNoteKey(user.publicKeyUint8);
			const { encryptedData } = await encryptNote(data, noteKey);
			const encryptedTags = tags && (await encryptTags(tags, noteKey));

			const note = {
				id: crypto.randomUUID(),
				ownerId: user.id,
				data: encryptedData,
				createdAt,
				updatedAt,
				dirty: 1
			} satisfies NoteType<Uint8Array>;
			const key = {
				id: crypto.randomUUID(),
				noteId: note.id,
				userId: user.id,
				encryptedKey,
				permission: 'edit',
				...(encryptedTags && { tags: encryptedTags, tagsUpdatedAt: now, tagsDirty: 1 })
			} satisfies NoteKey;
			return { note, key };
		})
	);

	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.notes.bulkAdd(records.map(({ note }) => note));
		await db.noteKeys.bulkAdd(records.map(({ key }) => key));
	});
	syncEngine.requestSync();

	return records.map(({ note }) => note.id);
}

/**
 * Adds a new note for the given user, empty unless given `content`.
 *
 * @param tags Tags to give the note right away, e.g. the tag that is being viewed.
 * @returns The ID of the new note.
 */
export const createNote = async (
	user: NoteOwner,
	tags?: NoteTags,
	content = '',
	meta: NoteData['meta'] = { color: DEFAULT_NOTE_COLOR }
) => {
	const [id] = await createNotes(user, [{ data: { content, meta }, tags }]);
	return id;
};

/**
 * Updates the content of an existing note. Encrypts the new content using the
 * provided decrypted note key and updates the note in the database.
 */
export const updateNoteData = async (
	noteId: string,
	newData: NoteData,
	decryptedNoteKey: Uint8Array,
	updatedAt = new Date()
) => {
	const { encryptedData: encryptedNote } = await encryptNote(newData, decryptedNoteKey);
	await db.notes.update(noteId, { data: encryptedNote, updatedAt, dirty: 1 });
	syncEngine.requestSync();
};

export const deleteNote = async (noteId: string) => {
	const deletedAt = new Date();
	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.noteKeys.where({ noteId }).delete();
		await db.notes.update(noteId, {
			data: new Uint8Array(),
			deletedAt,
			updatedAt: deletedAt,
			dirty: 1
		});
	});
	syncEngine.requestSync();
};

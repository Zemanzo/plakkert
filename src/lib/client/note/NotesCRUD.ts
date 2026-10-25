import { db, type NoteData, type NoteKey, type Note as NoteType } from '../Database';
import { encryptNote, getNoteKey } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import type { RuntimeUser } from '#lib/types.js';

// Notes are only written to IndexedDB here, and marked dirty. The sync engine sends them to the
// server in the background, so all of this also works offline.

/**
 * Adds a new note for the given user. Generates a new note key, encrypts an
 * empty note, and stores both the note and the encrypted key in the database.
 *
 * @returns The ID of the new note.
 */
export const createNote = async (user: RuntimeUser) => {
	const { noteKey, encryptedKey } = await getNoteKey(user.publicKeyUint8);
	const defaultNoteData = {
		content: '',
		meta: {
			color: 'yellow'
		}
	} satisfies NoteData;
	const { encryptedData } = await encryptNote(defaultNoteData, noteKey);
	const now = new Date();

	const note = {
		id: crypto.randomUUID(),
		ownerId: user.id,
		data: encryptedData,
		createdAt: now,
		updatedAt: now,
		dirty: 1
	} satisfies NoteType<Uint8Array>;

	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.notes.add(note);

		await db.noteKeys.add({
			id: crypto.randomUUID(),
			noteId: note.id,
			userId: user.id,
			encryptedKey
		} satisfies NoteKey);
	});
	syncEngine.requestSync();

	return note.id;
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

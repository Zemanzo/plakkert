import { db, type NoteKey, type Note as NoteType } from './Database';
import { encryptNote, getNoteKey } from './serialization/Serialize';
import type { RuntimeUser } from '$lib/types';

/**
 * Adds a new note for the given user. Generates a new note key, encrypts an
 * empty note, and stores both the note and the encrypted key in the database.
 */
export const createNote = async (user: RuntimeUser) => {
	const { noteKey, encryptedKey } = await getNoteKey(user.publicKeyUint8);
	const { encryptedData } = await encryptNote('', noteKey);
	const noteId = crypto.randomUUID();

	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.notes.add({
			id: noteId,
			ownerId: user.id,
			content: encryptedData,
			meta: {
				color: 'yellow'
			},
			createdAt: new Date(),
			updatedAt: new Date()
		} satisfies NoteType);

		await db.noteKeys.add({
			id: crypto.randomUUID(),
			noteId,
			userId: user.id,
			encryptedKey
		} satisfies NoteKey);
	});
};

/**
 * Updates the content of an existing note. Encrypts the new content using the
 * provided decrypted note key and updates the note in the database.
 */
export const updateNote = async (
	noteId: string,
	htmlContent: string,
	decryptedNoteKey: Uint8Array
) => {
	const { encryptedData: encryptedNote } = await encryptNote(htmlContent, decryptedNoteKey!);
	db.notes.update(noteId, { content: encryptedNote });
};

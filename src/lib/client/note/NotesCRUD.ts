import { db, type NoteKey, type Note as NoteType } from '../Database';
import { encryptNote, getNoteKey } from '../serialization/Serialize';
import type { RuntimeUser } from '$lib/types';

/**
 * Adds a new note for the given user. Generates a new note key, encrypts an
 * empty note, and stores both the note and the encrypted key in the database.
 */
export const createNote = async (user: RuntimeUser) => {
	const { noteKey, encryptedKey } = await getNoteKey(user.publicKeyUint8);
	const defaultNoteData = {
		content: '',
		meta: {
			color: 'yellow'
		}
	};
	const { encryptedData } = await encryptNote(defaultNoteData, noteKey);
	const noteId = crypto.randomUUID();

	const note = {
		id: noteId,
		ownerId: user.id,
		data: encryptedData,
		createdAt: new Date(),
		updatedAt: new Date()
	} satisfies NoteType<Uint8Array>;

	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.notes.add(note);

		await db.noteKeys.add({
			id: crypto.randomUUID(),
			noteId,
			userId: user.id,
			encryptedKey
		} satisfies NoteKey);
	});

	return [noteId, Promise.resolve({ ...note, data: defaultNoteData } satisfies NoteType)] as const;
};

/**
 * Updates the content of an existing note. Encrypts the new content using the
 * provided decrypted note key and updates the note in the database.
 */
export const updateNoteData = async (
	noteId: string,
	newData: NoteType['data'],
	decryptedNoteKey: Uint8Array
) => {
	const { encryptedData: encryptedNote } = await encryptNote(newData, decryptedNoteKey!);
	db.notes.update(noteId, { data: encryptedNote, updatedAt: new Date() });
};

export const deleteNote = async (noteId: string) => {
	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.noteKeys.where({ noteId }).delete();
		await db.notes.delete(noteId);
	});
};

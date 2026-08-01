import { db, type NoteKey, type Note as NoteType } from '../Database';
import { encryptNote, getNoteKey } from '../serialization/Serialize';
import type { RuntimeUser } from '$lib/types';

async function ensureOk(response: Response, message: string) {
	if (!response.ok) {
		throw new Error(message);
	}
}

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

	const createdAt = new Date();
	const updatedAt = new Date();

	const response = await fetch(`/api/notes/${noteId}`, {
		method: 'PUT',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			content: encryptedData.toBase64(),
			noteKey: encryptedKey.toBase64(),
			createdAt: createdAt.getTime(),
			updatedAt: updatedAt.getTime()
		})
	});
	await ensureOk(response, 'Failed to create note on server');

	const createdNote = (await response.json()) as {
		id: string;
	};

	const note = {
		id: createdNote.id,
		ownerId: user.id,
		data: encryptedData,
		createdAt,
		updatedAt
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

	return [note.id, Promise.resolve({ ...note, data: defaultNoteData } satisfies NoteType)] as const;
};

const debounceUpdateTimeoutMap = new Map<string, ReturnType<typeof setTimeout>>();

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
	const updatedAt = new Date();
	await db.notes.update(noteId, { data: encryptedNote, updatedAt });

	if (debounceUpdateTimeoutMap.has(noteId)) {
		clearTimeout(debounceUpdateTimeoutMap.get(noteId));
	}
	const debounceUpdateTimeout = setTimeout(async () => {
		const response = await fetch(`/api/notes/${noteId}`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				content: encryptedNote.toBase64(),
				updatedAt: updatedAt.getTime()
			})
		});
		await ensureOk(response, 'Failed to update note on server');
	}, 600);
	debounceUpdateTimeoutMap.set(noteId, debounceUpdateTimeout);
};

export const deleteNote = async (noteId: string) => {
	await db.transaction('rw', [db.notes, db.noteKeys], async () => {
		await db.noteKeys.where({ noteId }).delete();
		await db.notes.delete(noteId);
	});

	const response = await fetch(`/api/notes/${noteId}`, {
		method: 'DELETE'
	});
	await ensureOk(response, 'Failed to delete note on server');
};

import { db, type NoteData, type NoteKey, type Note as NoteType } from '../Database';
import { encryptNote, encryptTags, getNoteKey } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import { forgetHistory, historyTables, keepVersion } from '../history/LocalHistory';
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
 *
 * With `userId`, the note as it was is kept in the user's history when a session of editing
 * starts, or always with `keepPrevious: 'always'`, if they keep history. See `keepVersion`.
 */
export const updateNoteData = async (
	noteId: string,
	newData: NoteData,
	decryptedNoteKey: Uint8Array,
	{
		updatedAt = new Date(),
		userId,
		keepPrevious = 'auto'
	}: { updatedAt?: Date; userId?: string; keepPrevious?: 'auto' | 'always' } = {}
) => {
	const { encryptedData: encryptedNote } = await encryptNote(newData, decryptedNoteKey);
	await db.transaction('rw', historyTables, async () => {
		const stored = await db.notes.get(noteId);
		if (stored && userId) await keepVersion(stored, userId, updatedAt, keepPrevious);
		await db.notes.update(noteId, { data: encryptedNote, updatedAt, dirty: 1 });
	});
	syncEngine.requestSync();
};

/**
 * Changes the colour of several notes at once, all in one transaction: every
 * write updates the notes that are shown, which would take long for hundreds
 * of notes one by one. A note that changed in the meantime, e.g. by sync, is
 * left out.
 *
 * @returns How many notes were changed.
 */
export async function updateNotesColor(
	entries: { note: NoteType; noteKey: Uint8Array }[],
	color: string,
	userId?: string
) {
	const updatedAt = new Date();
	const changes = await Promise.all(
		entries
			.filter(({ note }) => note.data.meta.color !== color)
			.map(async ({ note, noteKey }) => {
				const data = { ...note.data, meta: { ...note.data.meta, color } };
				return { note, encryptedData: (await encryptNote(data, noteKey)).encryptedData };
			})
	);
	let changed = 0;
	await db.transaction('rw', historyTables, async () => {
		for (const { note, encryptedData } of changes) {
			const current = await db.notes.get(note.id);
			if (current?.updatedAt.getTime() !== note.updatedAt.getTime()) continue;
			if (userId) await keepVersion(current, userId, updatedAt);
			await db.notes.update(note.id, { data: encryptedData, updatedAt, dirty: 1 });
			changed++;
		}
	});
	syncEngine.requestSync();
	return changed;
}

/** Deletes notes the user owns, all in one transaction. They're deleted on the server on sync. */
export const deleteNotes = async (noteIds: string[]) => {
	const deletedAt = new Date();
	await db.transaction('rw', [db.notes, db.noteKeys, db.noteVersions], async () => {
		await db.noteKeys.where('noteId').anyOf(noteIds).delete();
		await forgetHistory(noteIds);
		for (const noteId of noteIds) {
			await db.notes.update(noteId, {
				data: new Uint8Array(),
				deletedAt,
				updatedAt: deletedAt,
				dirty: 1
			});
		}
	});
	syncEngine.requestSync();
};

export const deleteNote = (noteId: string) => deleteNotes([noteId]);

import { PUBLIC_APP_NAME } from '$app/env/public';
import { Dexie, type EntityTable } from 'dexie';
import type { Preferences } from './settings/Preferences';

export interface User {
	id: string;
	username: string;
	email: string;
	publicKey: string;
	privateKey: Uint8Array;
	salt: Uint8Array;
	nonce: Uint8Array;
	/** PBKDF2 iterations the private key was encrypted with. Missing for legacy records. */
	kdfIterations?: number;
	preferences: Preferences;
}

export interface NoteData {
	content: string;
	meta: {
		color: string;
	};
}

export interface Note<TData extends NoteData | Uint8Array = NoteData> {
	id: string;
	ownerId: string;
	/** Username of the owner, shown on notes that were shared with the user. */
	ownerUsername?: string;
	data: TData;
	createdAt: Date;
	updatedAt: Date;
	deletedAt?: Date;
	/** 1 when the note has local changes that haven't been sent to the server yet. */
	dirty?: 0 | 1;
	/**
	 * Since when the note's owner keeps its history, as the server told (see `history.ts`), or
	 * null when they don't. Missing until the note came from the server since there's history.
	 */
	historySince?: number | null;
}

/**
 * An earlier version of a note, for the user's history of it. See `history/LocalHistory.ts`.
 * Each device keeps the versions it made, and those it fetched from the server to show them.
 */
export interface NoteVersion {
	userId: string;
	noteId: string;
	/** The `updatedAt` the note had with this content, which tells versions apart. */
	updatedAt: Date;
	/** The note's data as it was stored then, encrypted with the note key. */
	data: Uint8Array;
	/** Since when the owner kept history when it was made, so it can go when that changes. */
	since: number;
	/** 1 when it hasn't been sent to the server yet. */
	unsent: 0 | 1;
}

export interface NoteKey {
	id: string;
	noteId: string;
	userId: string;
	encryptedKey: Uint8Array;
	/** What the user may do with the note. Missing for older records, which are all editable. */
	permission?: NotePermission;
	/** The user's tags for the note, encrypted with the note key. See `tags/Tags.ts`. */
	tags?: Uint8Array;
	/** When the tags last changed, for last-write-wins sync. Missing when there are no tags. */
	tagsUpdatedAt?: Date;
	/** 1 when the tags changed locally and haven't been sent to the server yet. */
	tagsDirty?: 0 | 1;
}

export type NotePermission = 'view' | 'edit';

/** How far a user's notes on this device are up to date with the server. */
export interface SyncState {
	userId: string;
	/** From the server: changes from this point on haven't been pulled yet. */
	cursor: number;
	/**
	 * Since when the user keeps the history of their notes, as the server told on the last pull,
	 * or null when they don't. Missing before the first pull since there's history.
	 */
	historySince?: number | null;
}

/** The user's settings that sync across devices, such as the order of their tags. */
export interface SyncedSettingsRecord {
	userId: string;
	/** Encrypted with the user's public key. See `settings/SyncedSettings.ts`. */
	content: Uint8Array;
	/** When the settings last changed, for last-write-wins sync. */
	updatedAt: Date;
	/** 1 when the settings changed locally and haven't been sent to the server yet. */
	dirty: 0 | 1;
}

const db = new Dexie(PUBLIC_APP_NAME) as Dexie & {
	// primary key "id" (for the typings only)
	users: EntityTable<User, 'id'>;
	// primary key "id" (for the typings only)
	notes: EntityTable<Note<Uint8Array>, 'id'>;
	// not the primary key but it doesnt support composite keys in typings, so we use "id" as a placeholder
	noteKeys: EntityTable<NoteKey, 'id'>;
	syncState: EntityTable<SyncState, 'userId'>;
	syncedSettings: EntityTable<SyncedSettingsRecord, 'userId'>;
	// The primary key is [userId+noteId+updatedAt]; "noteId" is a placeholder for the typings.
	noteVersions: EntityTable<NoteVersion, 'noteId'>;
};

// Indexed columns
db.version(1).stores({
	users: 'id, username',
	notes: 'id, ownerId, createdAt, updatedAt',
	noteKeys: '[noteId+userId], [userId+noteId]'
});

db.version(2).stores({
	users: 'id, username',
	notes: 'id, ownerId, createdAt, updatedAt, deletedAt',
	noteKeys: '[noteId+userId], [userId+noteId]'
});

// Earlier versions stored a "password hash" that was identical to the key used to encrypt the
// private key, which made the password unnecessary for decrypting it.
db.version(3)
	.stores({})
	.upgrade((tx) =>
		tx
			.table('users')
			.toCollection()
			.modify((user) => {
				delete user.passwordHash;
				// Usernames used to be stored as typed, while the server normalizes them to lowercase.
				user.username = user.username.toLowerCase();
			})
	);

// Notes are now written locally first and synced in the background. Existing notes are marked
// dirty, so they are reconciled with the server once (it keeps whichever version is newer).
db.version(4)
	.stores({
		notes: 'id, ownerId, createdAt, updatedAt, deletedAt, dirty'
	})
	.upgrade((tx) =>
		tx
			.table('notes')
			.toCollection()
			.modify((note) => {
				note.dirty = 1;
			})
	);

// Tags (including archived and trashed) are stored per user on their note key, and sync on their own.
db.version(5).stores({
	noteKeys: '[noteId+userId], [userId+noteId], tagsDirty'
});

// Only the changes since the last sync are pulled, rather than all notes every time.
db.version(6).stores({
	syncState: 'userId'
});

// Settings that sync across devices, such as the order of the tags.
db.version(7).stores({
	syncedSettings: 'userId'
});

// Note history: earlier versions of notes.
db.version(8).stores({
	noteVersions: '[userId+noteId+updatedAt], noteId, unsent'
});

export { db };

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
}

export interface NoteKey {
	id: string;
	noteId: string;
	userId: string;
	encryptedKey: Uint8Array;
	/** What the user may do with the note. Missing for older records, which are all editable. */
	permission?: NotePermission;
}

export type NotePermission = 'view' | 'edit';

const db = new Dexie(PUBLIC_APP_NAME) as Dexie & {
	// primary key "id" (for the typings only)
	users: EntityTable<User, 'id'>;
	// primary key "id" (for the typings only)
	notes: EntityTable<Note<Uint8Array>, 'id'>;
	// not the primary key but it doesnt support composite keys in typings, so we use "id" as a placeholder
	noteKeys: EntityTable<NoteKey, 'id'>;
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

export { db };

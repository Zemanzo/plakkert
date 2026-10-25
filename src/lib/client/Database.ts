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
	preferences: Preferences;
}

interface NoteData {
	content: string;
	meta: {
		color: string;
	};
}

export interface Note<TData extends NoteData | Uint8Array = NoteData> {
	id: string;
	ownerId: string;
	data: TData;
	createdAt: Date;
	updatedAt: Date;
	deletedAt?: Date;
}

export interface NoteKey {
	id: string;
	noteId: string;
	userId: string;
	encryptedKey: Uint8Array;
}

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
			})
	);

export { db };

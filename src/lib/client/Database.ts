import { PUBLIC_APP_NAME } from '$env/static/public';
import { Dexie, type EntityTable } from 'dexie';
import type { Preferences } from './settings/Preferences';

export interface User {
	id: string;
	username: string;
	email: string;
	publicKey: string;
	privateKey: Uint8Array;
	passwordHash: Uint8Array;
	salt: Uint8Array;
	nonce: Uint8Array;
	preferences: Preferences;
}

export interface Note {
	id: string;
	ownerId: string;
	content: Uint8Array;
	meta: {
		color: string;
	};
	createdAt: Date;
	updatedAt: Date;
}

export interface NoteKey {
	id: string;
	noteId: string;
	userId: string;
	encryptedKey: Uint8Array;
}

const db = new Dexie(PUBLIC_APP_NAME) as Dexie & {
	users: EntityTable<
		User,
		'id' // primary key "id" (for the typings only)
	>;
	notes: EntityTable<
		Note,
		'id' // primary key "id" (for the typings only)
	>;
	noteKeys: EntityTable<
		NoteKey,
		'id' // not the primary key but it doesnt support composite keys in typings, so we use "id" as a placeholder
	>;
};

// Indexed columns
db.version(1).stores({
	users: 'id, username',
	notes: 'id, ownerId, createdAt, updatedAt',
	noteKeys: '[noteId+userId], [userId+noteId]'
});

export { db };

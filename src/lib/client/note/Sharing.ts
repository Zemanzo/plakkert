import { ApiError, OfflineError, request } from '../Api';
import type { NotePermission } from '../Database';
import { decodeKey } from '../cryptography/PrivateKey';
import { sealNoteKey } from '../serialization/Serialize';
import { forgetNote, syncEngine } from '../sync/Sync.svelte';

// Sharing changes who has access on the server, so unlike editing notes, it needs a connection.

export interface NoteShare {
	userId: string;
	username: string;
	permissions: NotePermission;
}

/** Turns errors into messages that can be shown next to the sharing controls. */
function toSharingError(error: unknown, notFoundMessage = 'This note is not on the server yet.') {
	if (error instanceof OfflineError) {
		return new Error('You need to be online to change who this note is shared with.');
	}
	if (error instanceof ApiError && error.status === 404) {
		return new Error(notFoundMessage);
	}
	return error instanceof Error ? error : new Error('Unexpected error');
}

/** Lists who the note is shared with. Only works for the owner. */
export async function listShares(noteId: string) {
	try {
		const response = await request(`/api/notes/${noteId}/shares`);
		return (await response.json()) as NoteShare[];
	} catch (error) {
		throw toSharingError(error);
	}
}

/**
 * Shares a note with another user, or changes their permission. The note key
 * is encrypted with the recipient's public key, so only they can decrypt it.
 */
export async function shareNote(
	noteId: string,
	noteKey: Uint8Array,
	username: string,
	permissions: NotePermission
) {
	let recipient: { id: string; publicKey: string };
	try {
		const response = await request(`/api/users/${encodeURIComponent(username.trim())}`);
		recipient = await response.json();
	} catch (error) {
		throw toSharingError(error, `There is no user called "${username.trim()}".`);
	}

	const encryptedKey = await sealNoteKey(noteKey, decodeKey(recipient.publicKey));
	try {
		// A note that was created offline has to reach the server before it can be shared.
		await syncEngine.syncNow();
		await request(`/api/notes/${noteId}/shares/${recipient.id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ noteKey: encryptedKey.toBase64(), permissions })
		});
	} catch (error) {
		throw toSharingError(error);
	}
}

/** Stops sharing a note with a user. */
export async function unshareNote(noteId: string, userId: string) {
	try {
		await request(`/api/notes/${noteId}/shares/${userId}`, { method: 'DELETE' });
	} catch (error) {
		throw toSharingError(error);
	}
}

/** Removes a note that someone else shared with the user from their notes, on all devices. */
export async function leaveNote(noteId: string, userId: string) {
	try {
		await request(`/api/notes/${noteId}/shares/${userId}`, { method: 'DELETE' });
	} catch (error) {
		// Already gone from the server, so only the local copy is left.
		if (!(error instanceof ApiError && error.status === 404)) {
			throw toSharingError(error);
		}
	}
	await forgetNote(noteId, userId);
}

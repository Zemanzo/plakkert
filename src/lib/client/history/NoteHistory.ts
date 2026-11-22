import { ApiError, OfflineError, request } from '../Api';
import { db, type NoteData } from '../Database';
import { decryptNoteData } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import { forgetUserHistory, getLocalVersions, keepFetchedVersions } from './LocalHistory';

/** An earlier version of a note, decrypted to show it. */
export interface HistoryVersion {
	updatedAt: Date;
	data: NoteData;
}

export interface NoteHistory {
	/** Newest first, without the note as it is now. */
	versions: HistoryVersion[];
	/** Only the versions on this device could be shown, as the server couldn't be reached. */
	offline: boolean;
	/** The note's owner doesn't keep its history (anymore). */
	ownerStopped: boolean;
	/** How many versions couldn't be decrypted, and are left out. */
	failed: number;
}

/**
 * The earlier versions of a note, for the user: those on this device, and those on the server,
 * which are kept on this device too, to show them offline next time. They're only fetched here,
 * when the user asks for them, so syncing doesn't carry any history around.
 */
export async function loadHistory(
	userId: string,
	note: { id: string; updatedAt: Date },
	noteKey: Uint8Array
): Promise<NoteHistory> {
	let offline = false;
	let ownerStopped = false;
	try {
		const response = await request(`/api/notes/${encodeURIComponent(note.id)}/versions`);
		const { since, versions } = (await response.json()) as {
			since: number | null;
			versions: { updatedAt: number; content: string }[];
		};
		if (since === null) {
			ownerStopped = true;
		} else {
			await keepFetchedVersions(
				userId,
				note.id,
				since,
				versions.map(({ updatedAt, content }) => ({
					updatedAt: new Date(updatedAt),
					data: Uint8Array.fromBase64(content)
				}))
			);
		}
	} catch (error) {
		if (error instanceof OfflineError) {
			offline = true;
		} else if (!(error instanceof ApiError && error.status === 404)) {
			// 404: a new note that hasn't reached the server yet, so its history is all here.
			throw error;
		}
	}
	if (ownerStopped) return { versions: [], offline, ownerStopped, failed: 0 };

	const stored = (await getLocalVersions(userId, note.id)).filter(
		(version) => version.updatedAt.getTime() !== note.updatedAt.getTime()
	);
	const decrypted = await Promise.all(
		stored.map(async ({ updatedAt, data }) => {
			try {
				return { updatedAt, data: await decryptNoteData(data, noteKey) };
			} catch (error) {
				console.error(`Failed to decrypt a version of note ${note.id}`, error);
				return null;
			}
		})
	);
	const versions = decrypted.filter((version) => version !== null).reverse();
	return { versions, offline, ownerStopped, failed: decrypted.length - versions.length };
}

/**
 * Turns note history on or off for the user, which needs a connection. Off deletes the history of
 * all their notes, on the server and on this device; their other devices follow on their next sync.
 *
 * @returns Since when history is kept, or null when it's off.
 */
export async function setHistoryEnabled(userId: string, enabled: boolean) {
	const response = await request('/api/user/history', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ enabled })
	});
	const { since } = (await response.json()) as { since: number | null };
	await db.transaction('rw', db.syncState, db.noteVersions, async () => {
		// Before the first sync, that sync stores it.
		if (await db.syncState.get(userId)) await db.syncState.update(userId, { historySince: since });
		if (since === null) await forgetUserHistory(userId);
	});
	syncEngine.requestSync();
	return since;
}

/** Whether the user keeps the history of their notes, as the server tells. Needs a connection. */
export async function fetchHistoryEnabled() {
	const response = await request('/api/user/history');
	return ((await response.json()) as { since: number | null }).since !== null;
}

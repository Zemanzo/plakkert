import { liveQuery } from 'dexie';
import { db, type Note } from '../Database';
import { ApiError, fetchOrOffline, OfflineError, request, toApiError } from '../Api';
import { signInUsername } from '../auth/AuthApi';
import { getUnlockedSession } from '../auth/Session';
import { mergeServerNote, type MergeAction } from './Merge';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error';

interface SyncUser {
	id: string;
	username: string;
}

/** A note as returned by the `/api/notes` endpoints. Binary fields are base64 encoded. */
interface ServerNote {
	id: string;
	owner: string;
	content: string | null;
	noteKey: string;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

/** How long to wait after a local change, so that a burst of edits is sent together. */
const SYNC_DELAY_MS = 1000;
/** How often to check for changes made on other devices. */
const SYNC_INTERVAL_MS = 60_000;

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

async function applyServerNote(
	serverNote: ServerNote,
	userId: string,
	choose: (
		local: Note<Uint8Array> | undefined,
		server: { updatedAt: Date; deletedAt: Date | null }
	) => MergeAction = mergeServerNote
) {
	const createdAt = new Date(serverNote.createdAt);
	const updatedAt = new Date(serverNote.updatedAt);
	const deletedAt = serverNote.deletedAt ? new Date(serverNote.deletedAt) : null;
	const local = await db.notes.get(serverNote.id);

	switch (choose(local, { updatedAt, deletedAt })) {
		case 'keep-local':
			return;
		case 'delete-local':
			await db.noteKeys.where({ noteId: serverNote.id }).delete();
			await db.notes.update(serverNote.id, {
				data: new Uint8Array(),
				deletedAt: deletedAt ?? updatedAt,
				updatedAt,
				dirty: 0
			});
			return;
		case 'take-server':
			if (serverNote.content === null) return;
			await db.notes.put({
				id: serverNote.id,
				ownerId: serverNote.owner,
				data: Uint8Array.fromBase64(serverNote.content),
				createdAt,
				updatedAt,
				dirty: 0
			});
			if (!(await db.noteKeys.where({ noteId: serverNote.id, userId }).first())) {
				await db.noteKeys.put({
					id: crypto.randomUUID(),
					noteId: serverNote.id,
					userId,
					encryptedKey: Uint8Array.fromBase64(serverNote.noteKey)
				});
			}
	}
}

/** Clears the dirty flag, unless the note was changed again while it was being sent. */
async function markSynced(note: Note<Uint8Array>) {
	await db.transaction('rw', db.notes, async () => {
		const current = await db.notes.get(note.id);
		if (current && current.updatedAt.getTime() === note.updatedAt.getTime()) {
			await db.notes.update(note.id, { dirty: 0 });
		}
	});
}

async function pushNote(note: Note<Uint8Array>, userId: string) {
	const noteKey = await db.noteKeys.where({ noteId: note.id, userId }).first();
	const response = await fetchOrOffline(`/api/notes/${note.id}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			content: note.data.toBase64(),
			// Only used when the note doesn't exist on the server yet.
			noteKey: noteKey?.encryptedKey.toBase64(),
			createdAt: note.createdAt.getTime(),
			updatedAt: note.updatedAt.getTime()
		})
	});

	if (response.ok) {
		await markSynced(note);
	} else if (response.status === 409) {
		// The server has a version that is at least as new; take it, unless the note was edited
		// again in the meantime, in which case that newer edit is pushed next time.
		const serverNote = (await response.json()) as ServerNote;
		await db.transaction('rw', db.notes, db.noteKeys, () =>
			applyServerNote(serverNote, userId, (local, server) =>
				local && local.updatedAt > server.updatedAt ? 'keep-local' : 'take-server'
			)
		);
	} else if (response.status === 410) {
		// Deleted on another device.
		const serverNote = (await response.json()) as ServerNote;
		await db.transaction('rw', db.notes, db.noteKeys, () => applyServerNote(serverNote, userId));
	} else {
		throw await toApiError(response);
	}
}

async function pushDeletion(note: Note<Uint8Array>) {
	const response = await fetchOrOffline(`/api/notes/${note.id}`, { method: 'DELETE' });
	// 404: the note was deleted before it ever reached the server.
	if (response.ok || response.status === 404) {
		await markSynced(note);
	} else {
		throw await toApiError(response);
	}
}

/**
 * Sends all local changes to the server.
 *
 * @returns Whether every change was sent.
 */
async function pushChanges(userId: string) {
	const dirtyNotes = await db.notes
		.where('dirty')
		.equals(1)
		.filter((note) => note.ownerId === userId)
		.toArray();

	let succeeded = true;
	for (const note of dirtyNotes) {
		try {
			if (note.deletedAt) {
				await pushDeletion(note);
			} else {
				await pushNote(note, userId);
			}
		} catch (error) {
			if (error instanceof OfflineError || isUnauthorized(error)) throw error;
			// Keep going, so one problematic note doesn't block the others. It stays dirty and is
			// retried on the next sync.
			console.error(`Failed to sync note ${note.id}`, error);
			succeeded = false;
		}
	}
	return succeeded;
}

/** Applies all changes made on the server, e.g. from other devices. */
async function pullChanges(userId: string) {
	const response = await request('/api/notes');
	const serverNotes = (await response.json()) as ServerNote[];

	await db.transaction('rw', db.notes, db.noteKeys, async () => {
		for (const serverNote of serverNotes) {
			await applyServerNote(serverNote, userId);
		}
	});
}

/**
 * Keeps the notes in IndexedDB in sync with the server. All note changes are
 * made locally first; this sends them to the server in the background and
 * pulls in changes from other devices, whenever there is a connection.
 */
class SyncEngine {
	status = $state<SyncStatus>('idle');
	/** Number of notes with changes that haven't reached the server yet. */
	pendingChanges = $state(0);

	#user: SyncUser | null = null;
	#running: Promise<void> | null = null;
	#rerun = false;
	#timeout: ReturnType<typeof setTimeout> | undefined;
	#stopListening: (() => void) | null = null;
	/** Set when the server rejected the stored auth key, so we don't keep retrying. */
	#signInRejected = false;

	start(user: SyncUser) {
		if (this.#user?.id === user.id) return;
		this.stop();
		this.#user = user;
		this.#signInRejected = false;

		const pending = liveQuery(() =>
			db.notes
				.where('dirty')
				.equals(1)
				.filter((note) => note.ownerId === user.id)
				.count()
		).subscribe((count) => (this.pendingChanges = count));
		const syncNow = () => void this.syncNow();
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') syncNow();
		};
		window.addEventListener('online', syncNow);
		document.addEventListener('visibilitychange', onVisibilityChange);
		const interval = setInterval(syncNow, SYNC_INTERVAL_MS);

		this.#stopListening = () => {
			pending.unsubscribe();
			window.removeEventListener('online', syncNow);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			clearInterval(interval);
		};

		syncNow();
	}

	stop() {
		this.#stopListening?.();
		this.#stopListening = null;
		clearTimeout(this.#timeout);
		this.#user = null;
		this.status = 'idle';
		this.pendingChanges = 0;
	}

	/** Syncs shortly after a local change. */
	requestSync() {
		clearTimeout(this.#timeout);
		this.#timeout = setTimeout(() => void this.syncNow(), SYNC_DELAY_MS);
	}

	/** Syncs right away, also retrying a sign-in that was rejected before. */
	retry() {
		this.#signInRejected = false;
		return this.syncNow();
	}

	async syncNow(): Promise<void> {
		if (!this.#user) return;
		if (this.#running) {
			this.#rerun = true;
			return this.#running;
		}

		this.#running = this.#sync(this.#user).finally(() => {
			this.#running = null;
			if (this.#rerun) {
				this.#rerun = false;
				void this.syncNow();
			}
		});
		return this.#running;
	}

	async #sync(user: SyncUser) {
		clearTimeout(this.#timeout);
		this.status = 'syncing';
		let status: SyncStatus;
		try {
			await this.#ensureServerSession(user);
			const pushed = await pushChanges(user.id);
			await pullChanges(user.id);
			status = pushed ? 'idle' : 'error';
		} catch (error) {
			if (error instanceof OfflineError) {
				status = 'offline';
			} else if (isUnauthorized(error)) {
				status = 'signed-out';
			} else {
				console.error('Sync failed', error);
				status = 'error';
			}
		}
		// Ignore the result if the user signed out in the meantime.
		if (this.#user?.id === user.id) {
			this.status = status;
		}
	}

	/**
	 * Makes sure the server session belongs to this user. The session may have
	 * expired, or belong to another account, e.g. after signing out while
	 * offline. In that case, sign in again with the auth key from the unlocked
	 * session.
	 */
	async #ensureServerSession(user: SyncUser) {
		const response = await fetchOrOffline('/api/user');
		if (response.ok) {
			const serverUser = (await response.json()) as { id: string };
			if (serverUser.id === user.id) return;
		} else if (response.status !== 401) {
			throw await toApiError(response);
		}

		const session = getUnlockedSession();
		if (this.#signInRejected || session?.userId !== user.id) {
			throw new ApiError('Not signed in', 401);
		}
		try {
			await signInUsername(user.username, session.authKey);
		} catch (error) {
			if (isUnauthorized(error)) this.#signInRejected = true;
			throw error;
		}
	}
}

export const syncEngine = new SyncEngine();

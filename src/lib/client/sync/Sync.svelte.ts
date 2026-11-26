import { liveQuery } from 'dexie';
import { db, type Note, type NoteKey, type NotePermission, type NoteVersion } from '../Database';
import { ApiError, fetchOrOffline, OfflineError, request, toApiError } from '../Api';
import {
	forgetHistory,
	forgetOtherHistory,
	forgetUserHistory,
	getUnsentVersions,
	historyTables,
	keepVersion,
	markVersionsSent,
	thinOutAll
} from '../history/LocalHistory';
import { signInUsername } from '../auth/AuthApi';
import { getUnlockedSession } from '../auth/Session';
import { mergeServerNote, mergeServerTags, type MergeAction, type TagsMergeAction } from './Merge';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error';

interface SyncUser {
	id: string;
	username: string;
}

/** A note as returned by the `/api/notes` endpoints. Binary fields are base64 encoded. */
interface ServerNote {
	id: string;
	owner: string;
	ownerUsername: string;
	content: string | null;
	noteKey: string;
	permissions: NotePermission;
	/** The user's own tags for the note, encrypted with the note key. */
	tags: string | null;
	tagsUpdatedAt: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	/** Since when the owner keeps the note's history, or null when they don't. */
	historySince?: number | null;
}

/** The user's synced settings, as returned by the server. The content is base64 encoded. */
interface ServerSettings {
	content: string;
	updatedAt: string;
}

type ChooseTags = (
	local: NoteKey | undefined,
	server: { tagsUpdatedAt: Date | null }
) => TagsMergeAction;

/** How long to wait after a local change, so that a burst of edits is sent together. */
const SYNC_DELAY_MS = 1000;
/** How often to check for changes made on other devices. */
const SYNC_INTERVAL_MS = 60_000;

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/**
 * Removes the user's access to a note from this device, e.g. after it was
 * unshared. The note itself is only removed when no other user on this device
 * has access to it.
 */
export async function forgetNote(noteId: string, userId: string) {
	await db.transaction('rw', db.notes, db.noteKeys, db.noteVersions, async () => {
		await db.noteKeys.where({ noteId, userId }).delete();
		await forgetUserHistory(userId, noteId);
		if ((await db.noteKeys.where({ noteId }).count()) === 0) {
			await db.notes.delete(noteId);
			await forgetHistory([noteId]);
		}
	});
}

/** The tables to change a note from the server in, along with its history on this device. */
const NOTE_TABLES = [db.noteKeys, ...historyTables];

/**
 * Stores the user's note key and permission, which can change when the owner
 * reshares, and their tags for the note if the server has newer ones.
 */
async function updateAccess(
	serverNote: ServerNote,
	userId: string,
	chooseTags: ChooseTags = mergeServerTags
) {
	const noteKey = await db.noteKeys.where({ noteId: serverNote.id, userId }).first();
	const tagsUpdatedAt = serverNote.tagsUpdatedAt ? new Date(serverNote.tagsUpdatedAt) : null;
	const serverTags =
		chooseTags(noteKey, { tagsUpdatedAt }) === 'take-server' && tagsUpdatedAt
			? {
					tags: serverNote.tags ? Uint8Array.fromBase64(serverNote.tags) : undefined,
					tagsUpdatedAt,
					tagsDirty: 0 as const
				}
			: {};

	if (!noteKey) {
		await db.noteKeys.put({
			id: crypto.randomUUID(),
			noteId: serverNote.id,
			userId,
			encryptedKey: Uint8Array.fromBase64(serverNote.noteKey),
			permission: serverNote.permissions,
			...serverTags
		});
	} else if (noteKey.permission !== serverNote.permissions || 'tags' in serverTags) {
		await db.noteKeys
			.where({ noteId: serverNote.id, userId })
			.modify({ permission: serverNote.permissions, ...serverTags });
	}
}

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
	const historySince = serverNote.historySince ?? null;
	const local = await db.notes.get(serverNote.id);
	const action = choose(local, { updatedAt, deletedAt });

	if (action === 'delete-local') {
		await db.noteKeys.where({ noteId: serverNote.id }).delete();
		await forgetHistory([serverNote.id]);
		await db.notes.update(serverNote.id, {
			data: new Uint8Array(),
			deletedAt: deletedAt ?? updatedAt,
			updatedAt,
			dirty: 0
		});
		return;
	}
	// Deleted on the server and locally, or a local deletion that still has to be pushed. (One
	// that was pushed comes back with `take-server`, when a backup brought the note back.)
	if (deletedAt || (local?.deletedAt && action !== 'take-server')) return;

	if (action === 'take-server' && serverNote.content !== null) {
		// A change that wasn't sent yet loses to a newer one from elsewhere. It stays in the history,
		// so it can be brought back.
		if (local?.dirty) await keepVersion(local, userId, new Date(), 'always');
		await db.notes.put({
			id: serverNote.id,
			ownerId: serverNote.owner,
			ownerUsername: serverNote.ownerUsername,
			data: Uint8Array.fromBase64(serverNote.content),
			createdAt,
			updatedAt,
			dirty: 0,
			historySince
		});
	} else if (
		local &&
		(local.ownerUsername !== serverNote.ownerUsername ||
			(local.historySince ?? null) !== historySince)
	) {
		await db.notes.update(serverNote.id, { ownerUsername: serverNote.ownerUsername, historySince });
	}
	// The owner turned history off, or off and on again: what was kept before goes.
	if ((local?.historySince ?? null) !== historySince) {
		await forgetOtherHistory(serverNote.id, historySince);
	}
	await updateAccess(serverNote, userId);
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

/** What the server responded to an update of a note or its tags: the status, and the body. */
interface PushOutcome {
	status: number;
	body: unknown;
}

const errorMessage = (body: unknown) =>
	(body as { message?: string } | null)?.message ?? 'Something went wrong';

/** Handles what the server responded to an update of a note. */
async function applyNoteOutcome(
	note: Note<Uint8Array>,
	userId: string,
	{ status, body }: PushOutcome
) {
	if (status === 200) {
		await markSynced(note);
	} else if (status === 409) {
		// The server has a version that is at least as new; take it, unless the note was edited
		// again in the meantime, in which case that newer edit is pushed next time.
		await db.transaction('rw', NOTE_TABLES, async () =>
			applyServerNote(body as ServerNote, userId, (local, server) =>
				local && local.updatedAt > server.updatedAt ? 'keep-local' : 'take-server'
			)
		);
	} else if (status === 410) {
		// Deleted on another device.
		await db.transaction('rw', NOTE_TABLES, async () =>
			applyServerNote(body as ServerNote, userId)
		);
	} else if (status === 403) {
		// The owner made the note view-only. Drop the local edit, and take the server version.
		const serverNote = (await (await request(`/api/notes/${encodeURIComponent(note.id)}`)).json()) as ServerNote;
		await db.transaction('rw', NOTE_TABLES, async () =>
			applyServerNote(serverNote, userId, () => 'take-server')
		);
	} else if (status === 404 && note.ownerId !== userId) {
		// The note is no longer shared with this user.
		await forgetNote(note.id, userId);
	} else {
		throw new ApiError(errorMessage(body), status);
	}
}

/** Handles what the server responded to deleting a note. */
async function applyDeletionOutcome(note: Note<Uint8Array>, { status, body }: PushOutcome) {
	// 404: the note was deleted before it ever reached the server.
	if (status === 200 || status === 204 || status === 404) {
		await markSynced(note);
	} else {
		throw new ApiError(errorMessage(body), status);
	}
}

/** Clears the tags' dirty flag, unless they were changed again while they were being sent. */
async function markTagsSynced(noteKey: NoteKey) {
	await db.transaction('rw', db.noteKeys, async () => {
		const current = await db.noteKeys
			.where({ noteId: noteKey.noteId, userId: noteKey.userId })
			.first();
		if (current?.tagsUpdatedAt?.getTime() === noteKey.tagsUpdatedAt?.getTime()) {
			await db.noteKeys
				.where({ noteId: noteKey.noteId, userId: noteKey.userId })
				.modify({ tagsDirty: 0 });
		}
	});
}

/** Handles what the server responded to an update of the user's tags for a note. */
async function applyTagsOutcome(noteKey: NoteKey, userId: string, { status, body }: PushOutcome) {
	if (status === 200) {
		await markTagsSynced(noteKey);
	} else if (status === 409) {
		// The server has tags that are at least as new; take them, unless they were changed again
		// in the meantime, in which case those are pushed next time.
		await db.transaction('rw', NOTE_TABLES, async () =>
			updateAccess(body as ServerNote, userId, (local, server) =>
				local?.tagsUpdatedAt && server.tagsUpdatedAt && local.tagsUpdatedAt > server.tagsUpdatedAt
					? 'keep-local'
					: 'take-server'
			)
		);
	} else if (status === 410) {
		// The note was deleted, so its tags don't matter anymore.
		await db.transaction('rw', NOTE_TABLES, async () =>
			applyServerNote(body as ServerNote, userId)
		);
	} else if (status === 404) {
		const note = await db.notes.get(noteKey.noteId);
		// An own note that hasn't reached the server yet; its tags are sent once it has.
		if (note?.ownerId === userId) return;
		await forgetNote(noteKey.noteId, userId);
	} else {
		throw new ApiError(errorMessage(body), status);
	}
}

/** Returns the user's notes whose tags changed locally and haven't been sent yet. */
function getPushableTags(userId: string) {
	return db.noteKeys
		.where('tagsDirty')
		.equals(1)
		.filter((noteKey) => noteKey.userId === userId)
		.toArray();
}

/**
 * Returns the notes with local changes that this user can send: edits to notes
 * they may edit, and deletions of notes they own.
 */
async function getPushableNotes(userId: string) {
	const [dirtyNotes, noteKeys] = await Promise.all([
		db.notes.where('dirty').equals(1).toArray(),
		db.noteKeys.where({ userId }).toArray()
	]);
	const editableNoteIds = new Set(
		noteKeys.filter((noteKey) => noteKey.permission !== 'view').map((noteKey) => noteKey.noteId)
	);
	return dirtyNotes.filter((note) =>
		note.deletedAt ? note.ownerId === userId : editableNoteIds.has(note.id)
	);
}

/** At most this many notes are sent in one request, as the server allows. */
const BATCH_MAX_NOTES = 100;
/** And at most about this much, well below the server's limit on the size of a request. */
const BATCH_MAX_BYTES = 256 * 1024;

/** A note and/or its tags to send, or a deletion, and what was sent, to handle the outcome with. */
interface PushItem {
	id: string;
	deletion?: Note<Uint8Array>;
	note?: { local: Note<Uint8Array>; body: Record<string, unknown> };
	tags?: { local: NoteKey; body: Record<string, unknown> };
	/** Versions this device kept for the note's history. */
	versions?: { local: NoteVersion[]; body: Record<string, unknown>[] };
	/** Roughly how many bytes it adds to the request. */
	size: number;
}

/** What to send for the given changes to notes, tags and their history. */
async function getPushItems(
	userId: string,
	notes: Note<Uint8Array>[],
	noteKeys: NoteKey[],
	versions: NoteVersion[] = []
) {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, never rendered
	const items = new Map<string, PushItem>();
	const itemFor = (id: string) => {
		let item = items.get(id);
		if (!item) items.set(id, (item = { id, size: 0 }));
		return item;
	};

	const ownKeys = new Map(
		(await db.noteKeys.where({ userId }).toArray()).map((noteKey) => [noteKey.noteId, noteKey])
	);
	for (const note of notes) {
		if (note.deletedAt) {
			itemFor(note.id).deletion = note;
			itemFor(note.id).size += 100;
			continue;
		}
		const content = note.data.toBase64();
		const item = itemFor(note.id);
		item.note = {
			local: note,
			body: {
				content,
				// Only used when the note doesn't exist on the server yet.
				noteKey: ownKeys.get(note.id)?.encryptedKey.toBase64(),
				createdAt: note.createdAt.getTime(),
				updatedAt: note.updatedAt.getTime()
			}
		};
		item.size += content.length + 200;
	}
	// Sent along with the note if that changed too. The server stores the note first, so a new
	// note exists by the time its tags are stored.
	for (const noteKey of noteKeys) {
		const tags = (noteKey.tags ?? new Uint8Array()).toBase64();
		const item = itemFor(noteKey.noteId);
		item.tags = {
			local: noteKey,
			body: { tags, updatedAt: noteKey.tagsUpdatedAt?.getTime() ?? Date.now() }
		};
		item.size += tags.length + 100;
	}
	// After the note too, so it exists by then if it's new.
	for (const version of versions) {
		const content = version.data.toBase64();
		const item = itemFor(version.noteId);
		item.versions ??= { local: [], body: [] };
		item.versions.local.push(version);
		item.versions.body.push({
			content,
			updatedAt: version.updatedAt.getTime(),
			since: version.since
		});
		item.size += content.length + 100;
	}
	return [...items.values()];
}

/** Splits the items into requests that aren't too big. A big note is sent on its own. */
function inBatches(items: PushItem[]) {
	const batches: PushItem[][] = [];
	let batch: PushItem[] = [];
	let size = 0;
	for (const item of items) {
		if (
			batch.length >= BATCH_MAX_NOTES ||
			(batch.length > 0 && size + item.size > BATCH_MAX_BYTES)
		) {
			batches.push(batch);
			batch = [];
			size = 0;
		}
		batch.push(item);
		size += item.size;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/** Runs one push. On failure, keeps going, so one problematic note doesn't block the others. */
type Attempt = (noteId: string, push: () => Promise<void>) => Promise<void>;

/** Sends a batch of notes and tags, and handles what the server responded for each. */
async function pushBatch(batch: PushItem[], userId: string, attempt: Attempt) {
	const response = await fetchOrOffline('/api/notes/batch', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			notes: batch.map(({ id, note, tags, versions, deletion }) =>
				deletion
					? { id, delete: true }
					: { id, note: note?.body, tags: tags?.body, versions: versions?.body }
			)
		})
	});
	if (!response.ok) throw await toApiError(response);
	const { results } = (await response.json()) as {
		results: {
			id: string;
			note?: PushOutcome;
			tags?: PushOutcome;
			deleted?: PushOutcome;
			versions?: { status: number }[];
		}[];
	};

	// Versions are only sent once, whatever the server made of them: it refuses them when the
	// owner doesn't keep history, or when the user may only view the note, and then they stay on
	// this device only. That also means versions the server thinned out never come back.
	const answered = batch.flatMap(
		({ versions }, i) => versions?.local.filter((_, j) => results[i]?.versions?.[j]) ?? []
	);
	if (answered.length > 0) await markVersionsSent(answered);

	// What was stored is marked as synced all at once. Every transaction updates the notes that
	// are shown, which would take long for hundreds of them one by one.
	const isDone = (outcome?: PushOutcome) => !!outcome && [200, 204, 404].includes(outcome.status);
	await db.transaction('rw', db.notes, db.noteKeys, async () => {
		for (const [i, { note, tags, deletion }] of batch.entries()) {
			if (deletion && isDone(results[i]?.deleted)) await markSynced(deletion);
			if (note && results[i]?.note?.status === 200) await markSynced(note.local);
			if (tags && results[i]?.tags?.status === 200) await markTagsSynced(tags.local);
		}
	});
	for (const [i, { id, note, tags, deletion }] of batch.entries()) {
		const result = results[i];
		if (deletion && result?.deleted && !isDone(result.deleted)) {
			const outcome = result.deleted;
			await attempt(id, () => applyDeletionOutcome(deletion, outcome));
		}
		if (note && result?.note && result.note.status !== 200) {
			const outcome = result.note;
			await attempt(id, () => applyNoteOutcome(note.local, userId, outcome));
		}
		if (tags && result?.tags && result.tags.status !== 200) {
			const outcome = result.tags;
			await attempt(id, () => applyTagsOutcome(tags.local, userId, outcome));
		}
	}
}

/**
 * Sends all local changes to the server in batches, which is much faster than
 * one by one when there are many, e.g. after an import.
 *
 * @returns Whether every change was sent.
 */
async function pushChanges(userId: string) {
	let succeeded = true;
	const attempt: Attempt = async (noteId, push) => {
		try {
			await push();
		} catch (error) {
			if (error instanceof OfflineError || isUnauthorized(error)) throw error;
			// It stays dirty and is retried on the next sync.
			console.error(`Failed to sync note ${noteId}`, error);
			succeeded = false;
		}
	};

	const [notes, noteKeys, versions] = await Promise.all([
		getPushableNotes(userId),
		getPushableTags(userId),
		getUnsentVersions(userId)
	]);
	const items = await getPushItems(userId, notes, noteKeys, versions);
	for (const batch of inBatches(items)) {
		await attempt(batch[0].id, () => pushBatch(batch, userId, attempt));
	}
	return succeeded;
}

/** Stores the settings from the server, unless the local ones are newer (and still to be sent). */
async function applyServerSettings(userId: string, server: ServerSettings) {
	const updatedAt = new Date(server.updatedAt);
	const local = await db.syncedSettings.get(userId);
	if (local && local.updatedAt >= updatedAt) return;
	await db.syncedSettings.put({
		userId,
		content: Uint8Array.fromBase64(server.content),
		updatedAt,
		dirty: 0
	});
}

/** Sends the user's settings, if they changed. */
async function pushSettings(userId: string) {
	const local = await db.syncedSettings.get(userId);
	if (!local?.dirty) return;
	const response = await fetchOrOffline('/api/user/settings', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			content: local.content.toBase64(),
			updatedAt: local.updatedAt.getTime()
		})
	});
	if (response.ok || response.status === 409) {
		const body = response.ok ? null : ((await response.json()) as ServerSettings);
		await db.transaction('rw', db.syncedSettings, async () => {
			// Unless they were changed again while being sent; then those changes are sent next time.
			const current = await db.syncedSettings.get(userId);
			if (current?.updatedAt.getTime() !== local.updatedAt.getTime()) return;
			if (!body) {
				await db.syncedSettings.update(userId, { dirty: 0 });
				return;
			}
			// 409: the server has settings that are at least as new, so take them.
			await db.syncedSettings.put({
				userId,
				content: Uint8Array.fromBase64(body.content),
				updatedAt: new Date(body.updatedAt),
				dirty: 0
			});
		});
	} else {
		throw await toApiError(response);
	}
}

/** Number of notes with changes (to their content or tags) that haven't been sent yet, plus one
 * if the settings changed. */
async function countPendingChanges(userId: string) {
	const [notes, noteKeys, settings] = await Promise.all([
		getPushableNotes(userId),
		getPushableTags(userId),
		db.syncedSettings.get(userId)
	]);
	const noteIds = new Set([...notes.map((note) => note.id), ...noteKeys.map((key) => key.noteId)]);
	return noteIds.size + (settings?.dirty ? 1 : 0);
}

/**
 * Applies the changes made on the server since the last pull, e.g. from other
 * devices. The first time on a device, that's all notes.
 */
async function pullChanges(userId: string) {
	const state = await db.syncState.get(userId);
	const response = await request(
		state ? `/api/notes/changes?since=${state.cursor}` : '/api/notes/changes'
	);
	const {
		notes: serverNotes,
		ids,
		cursor,
		settings,
		history = null
	} = (await response.json()) as {
		notes: ServerNote[];
		ids: string[];
		cursor: number;
		/** Only when they changed. */
		settings?: ServerSettings | null;
		/** Since when the user keeps the history of their notes, or null when they don't. */
		history?: number | null;
	};

	// The cursor is only stored along with the changes, so none can be skipped.
	const tables = [...NOTE_TABLES, db.syncedSettings];
	await db.transaction('rw', tables, async () => {
		if (settings) await applyServerSettings(userId, settings);

		for (const serverNote of serverNotes) {
			await applyServerNote(serverNote, userId);
		}

		// Notes of others that the server no longer lists were unshared, or the user removed them
		// on another device. (Own notes that haven't been pushed yet aren't listed either.)
		const serverNoteIds = new Set(ids);
		for (const noteKey of await db.noteKeys.where({ userId }).toArray()) {
			if (serverNoteIds.has(noteKey.noteId)) continue;
			const note = await db.notes.get(noteKey.noteId);
			if (note?.ownerId === userId) continue;
			await forgetNote(noteKey.noteId, userId);
		}
		// History was turned off, maybe on another device: nothing of it is kept here either, also
		// of notes others shared, which follow their owner's setting but the user's too.
		if (history === null && state?.historySince !== null) await forgetUserHistory(userId);
		await db.syncState.put({ userId, cursor, historySince: history });
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
	/**
	 * When changes from the server were last applied in this session. Until then, the local
	 * notes may be outdated, e.g. a note that is still trashed here may be restored elsewhere.
	 */
	lastPulledAt = $state<Date | null>(null);

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

		const pending = liveQuery(() => countPendingChanges(user.id)).subscribe(
			(count) => (this.pendingChanges = count)
		);
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
		this.lastPulledAt = null;
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
			let pushed = await pushChanges(user.id);
			try {
				await pushSettings(user.id);
			} catch (error) {
				if (error instanceof OfflineError || isUnauthorized(error)) throw error;
				// They stay dirty, and are sent on the next sync.
				console.error('Failed to sync the settings', error);
				pushed = false;
			}
			await pullChanges(user.id);
			if (this.#user?.id === user.id) {
				// Versions expire, also of notes that aren't changed anymore. Once a session is enough.
				if (!this.lastPulledAt) {
					thinOutAll().catch((error) => console.error('Failed to thin out the history', error));
				}
				this.lastPulledAt = new Date();
			}
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

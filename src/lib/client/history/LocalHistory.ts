import { Dexie } from 'dexie';
import { keepsPrevious, versionsToDrop } from '#lib/history.js';
import { db, type Note, type NoteVersion } from '../Database';

// Note history on this device: versions this device made, which are sent to the server along with
// the notes, and versions fetched from the server to show them, which are kept for offline use.
// They follow the same rules as on the server (see `src/lib/history.ts`), and are encrypted like
// the notes are.

/** The tables a transaction that keeps versions needs, besides what it changes itself. */
export const historyTables = [db.notes, db.noteVersions, db.syncState];

/** The user's versions of a note, oldest first. */
const versionsOf = (userId: string, noteId: string) =>
	db.noteVersions
		.where('[userId+noteId+updatedAt]')
		.between([userId, noteId, Dexie.minKey], [userId, noteId, Dexie.maxKey]);

/** Since when the user keeps the history of their own notes, or null when they don't. */
export async function ownHistorySince(userId: string) {
	return (await db.syncState.get(userId))?.historySince ?? null;
}

/**
 * Since when the note's history is kept, for this user: as long as its owner keeps it, and the
 * user too, if it's someone else's. Null when it isn't.
 */
export async function historySinceOf(
	note: Pick<Note<Uint8Array>, 'ownerId' | 'historySince'>,
	userId: string
) {
	const own = await ownHistorySince(userId);
	if (own === null) return null;
	return note.ownerId === userId ? own : (note.historySince ?? null);
}

/**
 * Keeps the note as it is stored, before it's changed, as a version: when a session of editing
 * starts (see `keepsPrevious`), or with `always`, e.g. before it's restored to another version, or
 * before a change that wasn't sent yet is replaced by a newer one from the server. Run it in a
 * transaction with `historyTables`.
 *
 * @returns Whether a version was kept.
 */
export async function keepVersion(
	stored: Note<Uint8Array>,
	userId: string,
	changedAt: Date,
	mode: 'auto' | 'always' = 'auto'
) {
	if (stored.deletedAt || stored.data.length === 0) return false;
	const since = await historySinceOf(stored, userId);
	if (since === null) return false;

	const latest = await versionsOf(userId, stored.id).last();
	const previous = { updatedAt: stored.updatedAt.getTime(), createdAt: stored.createdAt.getTime() };
	if (latest?.updatedAt.getTime() === previous.updatedAt) return false;
	if (
		mode === 'auto' &&
		!keepsPrevious(previous, changedAt.getTime(), latest?.updatedAt.getTime())
	) {
		return false;
	}
	const key = [userId, stored.id, stored.updatedAt];
	if ((await db.noteVersions.where('[userId+noteId+updatedAt]').equals(key).count()) > 0) {
		return false;
	}
	await db.noteVersions.add({
		userId,
		noteId: stored.id,
		updatedAt: stored.updatedAt,
		data: stored.data,
		since,
		unsent: 1
	});
	await thinOut(userId, stored.id);
	return true;
}

/** Deletes the user's versions of a note that aren't kept anymore. See `versionsToDrop`. */
export async function thinOut(userId: string, noteId: string, now = Date.now()) {
	const versions = await versionsOf(userId, noteId).toArray();
	const drop = new Set(
		versionsToDrop(
			versions.map((version) => ({
				updatedAt: version.updatedAt.getTime(),
				size: version.data.length
			})),
			now
		)
	);
	if (drop.size === 0) return;
	await versionsOf(userId, noteId)
		.filter((version) => drop.has(version.updatedAt.getTime()))
		.delete();
}

/**
 * Deletes the versions on this device that have expired, e.g. of notes that aren't changed
 * anymore. Only by age: the size of a note's history is kept in check as versions are added.
 */
export async function thinOutAll(now = Date.now()) {
	const keys = (await db.noteVersions.toCollection().primaryKeys()) as unknown as [
		string,
		string,
		Date
	][];
	const byNote = new Map<string, [string, string, Date][]>();
	for (const key of keys) {
		const id = `${key[0]}\n${key[1]}`;
		byNote.set(id, [...(byNote.get(id) ?? []), key]);
	}
	const drop = [...byNote.values()].flatMap((noteKeys) => {
		const times = new Set(
			versionsToDrop(
				noteKeys.map(([, , updatedAt]) => ({ updatedAt: updatedAt.getTime(), size: 0 })),
				now
			)
		);
		return noteKeys.filter(([, , updatedAt]) => times.has(updatedAt.getTime()));
	});
	if (drop.length > 0) await db.noteVersions.bulkDelete(drop as never[]);
}

/** Deletes every user's versions of a note on this device, e.g. once it's deleted forever. */
export function forgetHistory(noteIds: string[]) {
	return db.noteVersions.where('noteId').anyOf(noteIds).delete();
}

/** Deletes the user's versions on this device: of one note, or of all notes. */
export function forgetUserHistory(userId: string, noteId?: string) {
	if (noteId !== undefined) return versionsOf(userId, noteId).delete();
	return db.noteVersions
		.where('[userId+noteId+updatedAt]')
		.between([userId, Dexie.minKey, Dexie.minKey], [userId, Dexie.maxKey, Dexie.maxKey])
		.delete();
}

/**
 * Deletes the versions of a note that were made while its owner's history had another start, as
 * history was turned off since, and maybe on again. Null deletes them all.
 */
export function forgetOtherHistory(noteId: string, since: number | null) {
	return db.noteVersions
		.where('noteId')
		.equals(noteId)
		.filter((version) => version.since !== since)
		.delete();
}

/** The user's versions that haven't been sent to the server yet. */
export function getUnsentVersions(userId: string) {
	return db.noteVersions
		.where('unsent')
		.equals(1)
		.filter((version) => version.userId === userId)
		.toArray();
}

/** Marks versions as sent, so they're never sent again, even once the server thinned them out. */
export async function markVersionsSent(versions: NoteVersion[]) {
	await db.transaction('rw', db.noteVersions, async () => {
		for (const { userId, noteId, updatedAt } of versions) {
			await db.noteVersions
				.where('[userId+noteId+updatedAt]')
				.equals([userId, noteId, updatedAt])
				.modify({ unsent: 0 });
		}
	});
}

/**
 * Keeps versions fetched from the server, so they can be shown offline too. Versions that are on
 * this device already stay as they are.
 */
export async function keepFetchedVersions(
	userId: string,
	noteId: string,
	since: number,
	versions: { updatedAt: Date; data: Uint8Array }[]
) {
	await db.transaction('rw', db.noteVersions, async () => {
		const known = new Set(
			(await versionsOf(userId, noteId).toArray()).map((version) => version.updatedAt.getTime())
		);
		const missing = versions.filter((version) => !known.has(version.updatedAt.getTime()));
		await db.noteVersions.bulkAdd(
			missing.map((version) => ({ userId, noteId, ...version, since, unsent: 0 as const }))
		);
		await thinOut(userId, noteId);
	});
}

/** The user's versions of a note on this device, oldest first. */
export function getLocalVersions(userId: string, noteId: string) {
	return versionsOf(userId, noteId).toArray();
}

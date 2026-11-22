import { and, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { keepsPrevious, versionsToDrop } from '#lib/history.js';
import { db } from './db/index';
import { noteHistory, notes, noteVersions, userNotes } from './db/schema';
import { changeStamp, isClientTime } from './notes';

// Note history on the server. The server keeps the note as it was before each session of editing
// (see `keepsPrevious`), and stores versions that devices made themselves, e.g. while offline.
// Versions are encrypted like notes, so the server can't read them, but it can thin them out,
// which only needs their times and sizes.

type Executor = Pick<typeof db, 'select'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Since when the user keeps the history of their notes, as a `changeStamp`, or null if they don't.
 * Versions are made with this, so ones from before history was last turned off can be refused.
 */
export function historySince(userId: string, executor: Executor = db): number | null {
	return (
		executor
			.select({ enabledAt: noteHistory.enabledAt })
			.from(noteHistory)
			.where(eq(noteHistory.userId, userId))
			.get()?.enabledAt ?? null
	);
}

/**
 * Turns history on or off for the user's notes. Off deletes the history of all their notes. Their
 * notes are marked as changed either way, so their devices, and the people they're shared with,
 * learn of it on their next sync.
 *
 * @returns Since when history is kept, or null when it's off.
 */
export function setHistoryEnabled(userId: string, enabled: boolean): number | null {
	return db.transaction((tx) => {
		const current = historySince(userId, tx);
		if (enabled === (current !== null)) return current;

		const ownNoteIds = tx.select({ id: notes.id }).from(notes).where(eq(notes.owner, userId));
		let since: number | null = null;
		if (enabled) {
			since = changeStamp();
			tx.insert(noteHistory).values({ userId, enabledAt: since }).run();
		} else {
			tx.delete(noteVersions).where(inArray(noteVersions.noteId, ownNoteIds)).run();
			tx.delete(noteHistory).where(eq(noteHistory.userId, userId)).run();
		}
		tx.update(notes).set({ changedAt: changeStamp() }).where(eq(notes.owner, userId)).run();
		return since;
	});
}

/** Deletes the versions of a note that aren't kept anymore. See `versionsToDrop`. */
export function thinOut(tx: Transaction, noteId: string, now = Date.now()) {
	const versions = tx
		.select({
			updatedAt: noteVersions.updatedAt,
			size: sql<number>`length(${noteVersions.content})`
		})
		.from(noteVersions)
		.where(eq(noteVersions.noteId, noteId))
		.all();
	const drop = versionsToDrop(
		versions.map(({ updatedAt, size }) => ({ updatedAt: updatedAt.getTime(), size })),
		now
	);
	if (drop.length === 0) return;
	tx.delete(noteVersions)
		.where(
			and(
				eq(noteVersions.noteId, noteId),
				inArray(
					noteVersions.updatedAt,
					drop.map((at) => new Date(at))
				)
			)
		)
		.run();
}

/** Thins out the history of every note, for notes that aren't changed anymore. */
export function thinOutAll(now = Date.now()) {
	const noteIds = db
		.selectDistinct({ noteId: noteVersions.noteId })
		.from(noteVersions)
		.all()
		.map((row) => row.noteId);
	for (const noteId of noteIds) {
		db.transaction((tx) => thinOut(tx, noteId, now));
	}
}

/** How often `thinOutAll` runs. */
const THIN_OUT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Thins out all history now, and then once a day. */
export function startThinningOut() {
	const run = () => {
		try {
			thinOutAll();
		} catch (error) {
			console.error('Failed to thin out note history', error);
		}
	};
	run();
	setInterval(run, THIN_OUT_INTERVAL_MS).unref();
}

/** The note as stored, before a change. */
interface StoredNote {
	id: string;
	owner: string;
	content: unknown;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Keeps a note as it is stored, before it's changed, if its owner keeps history: when a session of
 * editing starts (see `keepsPrevious`), or with `always`, e.g. before an MCP app changes it. Run
 * it in the transaction that changes the note.
 */
export function keepPreviousVersion(
	tx: Transaction,
	stored: StoredNote,
	changedAt: Date,
	mode: 'auto' | 'always' = 'auto'
) {
	if (!stored.content || historySince(stored.owner, tx) === null) return;
	const latest = tx
		.select({ at: max(noteVersions.updatedAt) })
		.from(noteVersions)
		.where(eq(noteVersions.noteId, stored.id))
		.get()?.at;
	const latestAt = latest == null ? undefined : new Date(latest).getTime();
	const previous = { updatedAt: stored.updatedAt.getTime(), createdAt: stored.createdAt.getTime() };
	if (mode === 'auto' && !keepsPrevious(previous, changedAt.getTime(), latestAt)) return;

	tx.insert(noteVersions)
		.values({ noteId: stored.id, updatedAt: stored.updatedAt, content: stored.content as Buffer })
		.onConflictDoNothing()
		.run();
	thinOut(tx, stored.id);
}

/**
 * The outcome of storing a version a device made: 200 when it's stored, or was already; 409 when
 * the owner doesn't keep history (anymore), or has turned it off and on since it was made.
 */
export type VersionStatus = 200 | 400 | 403 | 404 | 409 | 410;

/**
 * Stores a version of a note that a device made, e.g. while offline, or of a change that lost to
 * a newer one on another device. Only for people who may edit the note. Run it in a transaction.
 */
export function storeVersion(
	tx: Transaction,
	userId: string,
	noteId: string,
	{ content, updatedAt, since }: Record<string, unknown>
): VersionStatus {
	if (typeof content !== 'string' || content.length === 0) return 400;
	if (!isClientTime(updatedAt) || typeof since !== 'number') return 400;

	const access = tx
		.select({ owner: notes.owner, deletedAt: notes.deletedAt, permissions: userNotes.permissions })
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.where(and(eq(userNotes.userId, userId), eq(userNotes.noteId, noteId)))
		.get();
	if (!access) return 404;
	if (access.deletedAt) return 410;
	if (access.permissions !== 'edit') return 403;
	if (historySince(access.owner, tx) !== since) return 409;

	tx.insert(noteVersions)
		.values({ noteId, updatedAt: new Date(updatedAt), content: Buffer.from(content, 'base64') })
		.onConflictDoNothing()
		.run();
	thinOut(tx, noteId);
	return 200;
}

/**
 * The versions of a note that the user may see, oldest first, with their content base64 encoded:
 * none when its owner doesn't keep history, and for people it's shared with, only those from after
 * it was shared with them. Null when the user has no access to the note.
 */
export function listVersions(userId: string, noteId: string) {
	return db.transaction((tx) => {
		const access = tx
			.select({ owner: notes.owner, deletedAt: notes.deletedAt, sharedAt: userNotes.createdAt })
			.from(userNotes)
			.innerJoin(notes, eq(userNotes.noteId, notes.id))
			.where(and(eq(userNotes.userId, userId), eq(userNotes.noteId, noteId)))
			.get();
		if (!access || access.deletedAt) return null;
		const since = historySince(access.owner, tx);
		if (since === null) return { since, versions: [] };

		// Versions that aren't kept anymore go first, as they could be weeks old by now.
		thinOut(tx, noteId);
		const versions = tx
			.select({ updatedAt: noteVersions.updatedAt, content: noteVersions.content })
			.from(noteVersions)
			.where(
				and(
					eq(noteVersions.noteId, noteId),
					access.owner === userId ? undefined : gte(noteVersions.updatedAt, access.sharedAt)
				)
			)
			.orderBy(noteVersions.updatedAt)
			.all();
		return {
			since,
			versions: versions.map(({ updatedAt, content }) => ({
				updatedAt: updatedAt.getTime(),
				content: (content as Buffer).toString('base64')
			}))
		};
	});
}

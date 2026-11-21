import { and, eq, gte, max, ne, or } from 'drizzle-orm';
import { db } from './db/index';
import { notes, user, userNotes, userSettings } from './db/schema';

let lastStamp: number | undefined;

/**
 * The time to store as `changedAt` with a change, and to give clients as the
 * point to ask for changes from. It's the server's clock in milliseconds, but
 * never goes backwards, even if the clock does, so no change can end up before
 * a point a client already has.
 */
export function changeStamp() {
	lastStamp ??= Math.max(
		db
			.select({ value: max(notes.changedAt) })
			.from(notes)
			.get()?.value ?? 0,
		db
			.select({ value: max(userNotes.changedAt) })
			.from(userNotes)
			.get()?.value ?? 0,
		db
			.select({ value: max(userSettings.changedAt) })
			.from(userSettings)
			.get()?.value ?? 0
	);
	lastStamp = Math.max(Date.now(), lastStamp);
	return lastStamp;
}

/** The ids of all notes the user has access to, including deleted ones. */
export function selectUserNoteIds(userId: string, executor: Pick<typeof db, 'select'> = db) {
	return executor
		.select({ id: userNotes.noteId })
		.from(userNotes)
		.where(eq(userNotes.userId, userId))
		.all()
		.map((row) => row.id);
}

/**
 * Selects the notes a user has access to, along with their encrypted note key.
 *
 * @param which One note, or the notes that changed at or after a `changeStamp`: their content,
 *   deletion, or the user's access or tags. Notes the user lost access to aren't listed; see
 *   `selectUserNoteIds`. All notes when left out.
 * @param executor The database, or a transaction to run the query in.
 */
export function selectUserNotes(
	userId: string,
	which?: string | { changedSince: number },
	executor: Pick<typeof db, 'select'> = db
) {
	return executor
		.select({
			id: notes.id,
			owner: notes.owner,
			ownerUsername: user.username,
			content: notes.content,
			noteKey: userNotes.noteKey,
			permissions: userNotes.permissions,
			tags: userNotes.tags,
			tagsUpdatedAt: userNotes.tagsUpdatedAt,
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt,
			deletedAt: notes.deletedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.innerJoin(user, eq(notes.owner, user.id))
		.where(
			and(
				eq(userNotes.userId, userId),
				typeof which === 'string'
					? eq(notes.id, which)
					: which &&
							or(
								gte(notes.changedAt, which.changedSince),
								gte(userNotes.changedAt, which.changedSince)
							)
			)
		);
}

export type UserNoteRow = Awaited<ReturnType<typeof selectUserNotes>>[number];

/** Converts a note row to JSON, with the encrypted content and tags base64 encoded. */
export function toNoteJson(row: UserNoteRow) {
	return {
		...row,
		content: row.content ? (row.content as Buffer).toString('base64') : null,
		tags: row.tags ? (row.tags as Buffer).toString('base64') : null
	};
}

/** Returns the note if it exists and is owned by the user, for managing who it's shared with. */
export async function findOwnedNote(noteId: string, userId: string) {
	const [note] = await db
		.select({ owner: notes.owner, deletedAt: notes.deletedAt })
		.from(notes)
		.where(eq(notes.id, noteId));
	return note && note.owner === userId ? note : null;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The outcome of a write, as an HTTP status, with the stored note where the client needs it. */
export type WriteResult =
	| { status: 200; body: Record<string, unknown> }
	| { status: 409 | 410; note: UserNoteRow }
	| { status: 400 | 403 | 404 | 413; message: string };

/** Tags are a short encrypted list, so anything much bigger is a mistake or abuse. */
const MAX_TAGS_BYTES = 64 * 1024;

/**
 * Creates or updates a note. Updates follow last-write-wins on `updatedAt`: an
 * update that is not newer than the stored note is rejected with 409, along
 * with the stored note so the client can take it instead. Run it in a
 * transaction, so the checks and the write can't interleave with another
 * request for the same note (better-sqlite3 transactions are synchronous).
 */
export function writeNote(
	tx: Transaction,
	userId: string,
	noteId: string,
	{ content, noteKey, createdAt, updatedAt }: Record<string, unknown>
): WriteResult {
	if (typeof content !== 'string') return { status: 400, message: 'content is required' };
	if (typeof updatedAt !== 'number') return { status: 400, message: 'updatedAt is required' };
	const updatedAtDate = new Date(updatedAt);
	const contentBuffer = Buffer.from(content, 'base64');

	const [userNote] = selectUserNotes(userId, noteId, tx).all();

	if (!userNote) {
		const existing = tx.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get();
		if (existing) return { status: 404, message: 'Not found' };
		if (typeof noteKey !== 'string') {
			return { status: 400, message: 'noteKey is required when creating a note' };
		}
		if (typeof createdAt !== 'number') return { status: 400, message: 'createdAt is required' };

		const created = tx
			.insert(notes)
			.values({
				id: noteId,
				owner: userId,
				content: contentBuffer,
				createdAt: new Date(createdAt),
				updatedAt: updatedAtDate,
				changedAt: changeStamp()
			})
			.returning({ id: notes.id, updatedAt: notes.updatedAt })
			.get();
		tx.insert(userNotes)
			.values({ userId, noteId, noteKey, permissions: 'edit', changedAt: changeStamp() })
			.run();
		return { status: 200, body: created };
	}

	if (userNote.deletedAt) return { status: 410, note: userNote };
	if (userNote.permissions !== 'edit') return { status: 403, message: 'Forbidden' };
	if (updatedAtDate <= userNote.updatedAt) return { status: 409, note: userNote };

	const updated = tx
		.update(notes)
		.set({ content: contentBuffer, updatedAt: updatedAtDate, changedAt: changeStamp() })
		.where(eq(notes.id, noteId))
		.returning({ id: notes.id, updatedAt: notes.updatedAt })
		.get();
	return { status: 200, body: updated };
}

/**
 * Replaces the user's tags for a note. Tags are per user, so anyone with
 * access to the note can change their own, including view-only users. Like
 * note content, they follow last-write-wins on `updatedAt`: an update that is
 * not newer than the stored tags is rejected with 409, along with the stored
 * note so the client can take its tags instead. Run it in a transaction.
 */
export function writeTags(
	tx: Transaction,
	userId: string,
	noteId: string,
	{ tags, updatedAt }: Record<string, unknown>
): WriteResult {
	if (typeof tags !== 'string') return { status: 400, message: 'tags is required' };
	if (typeof updatedAt !== 'number') return { status: 400, message: 'updatedAt is required' };
	const tagsBuffer = Buffer.from(tags, 'base64');
	if (tagsBuffer.length > MAX_TAGS_BYTES) return { status: 413, message: 'Too many tags' };
	const updatedAtDate = new Date(updatedAt);

	const [userNote] = selectUserNotes(userId, noteId, tx).all();

	if (!userNote) return { status: 404, message: 'Not found' };
	if (userNote.deletedAt) return { status: 410, note: userNote };
	if (userNote.tagsUpdatedAt && updatedAtDate <= userNote.tagsUpdatedAt) {
		return { status: 409, note: userNote };
	}

	tx.update(userNotes)
		.set({ tags: tagsBuffer, tagsUpdatedAt: updatedAtDate, changedAt: changeStamp() })
		.where(and(eq(userNotes.noteId, noteId), eq(userNotes.userId, userId)))
		.run();
	return { status: 200, body: { id: noteId, tagsUpdatedAt: updatedAtDate } };
}

/** The JSON a single write responds with: what was stored, or the note that won, or an error. */
export function writeResultJson(result: WriteResult) {
	if (result.status === 200) return result.body;
	if ('note' in result) return toNoteJson(result.note);
	return { message: result.message };
}

export type SharePermission = 'view' | 'edit';

/**
 * Shares a note with a user, or changes their permission. Check first that the note is the
 * sharer's own, and not deleted. The note key must already be sealed to the recipient's public
 * key, so the server never sees it.
 */
export function upsertShare(
	executor: Pick<typeof db, 'insert'>,
	noteId: string,
	recipientId: string,
	noteKey: string,
	permissions: SharePermission
) {
	executor
		.insert(userNotes)
		.values({ userId: recipientId, noteId, noteKey, permissions, changedAt: changeStamp() })
		.onConflictDoUpdate({
			target: [userNotes.userId, userNotes.noteId],
			set: { noteKey, permissions, changedAt: changeStamp() }
		})
		.run();
}

/** Takes a user's access to a note away. Check first that the caller may. */
export function removeShare(executor: Pick<typeof db, 'delete'>, noteId: string, userId: string) {
	return (
		executor
			.delete(userNotes)
			.where(and(eq(userNotes.noteId, noteId), eq(userNotes.userId, userId)))
			.run().changes > 0
	);
}

/** Who a note is shared with, besides its owner, by name. */
export function listShares(
	noteId: string,
	ownerId: string,
	executor: Pick<typeof db, 'select'> = db
) {
	return executor
		.select({
			userId: userNotes.userId,
			username: user.username,
			permissions: userNotes.permissions
		})
		.from(userNotes)
		.innerJoin(user, eq(userNotes.userId, user.id))
		.where(and(eq(userNotes.noteId, noteId), ne(userNotes.userId, ownerId)))
		.orderBy(user.username)
		.all();
}

/**
 * Deletes a note the user owns, leaving a tombstone so the deletion syncs.
 * Deleting twice is fine, e.g. when a client retries after losing the
 * response. Run it in a transaction.
 */
export function deleteNote(
	tx: Transaction,
	userId: string,
	noteId: string
): { status: 204 | 403 | 404 } {
	const note = tx
		.select({ owner: notes.owner, deletedAt: notes.deletedAt })
		.from(notes)
		.where(eq(notes.id, noteId))
		.get();
	if (!note) return { status: 404 };
	if (note.owner !== userId) return { status: 403 };
	if (note.deletedAt) return { status: 204 };

	const now = new Date();
	const changedAt = changeStamp();
	tx.update(notes)
		.set({ content: null, deletedAt: now, updatedAt: now, changedAt })
		.where(eq(notes.id, noteId))
		.run();
	// Everyone's tags are encrypted with the note key too, so they go along with the content.
	tx.update(userNotes)
		.set({ tags: null, tagsUpdatedAt: null, changedAt })
		.where(eq(userNotes.noteId, noteId))
		.run();
	return { status: 204 };
}

import { and, eq } from 'drizzle-orm';
import { db } from './db/index';
import { notes, user, userNotes } from './db/schema';

/**
 * Selects the notes a user has access to, along with their encrypted note key.
 *
 * @param executor The database, or a transaction to run the query in.
 */
export function selectUserNotes(
	userId: string,
	noteId?: string,
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
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt,
			deletedAt: notes.deletedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.innerJoin(user, eq(notes.owner, user.id))
		.where(
			noteId
				? and(eq(userNotes.userId, userId), eq(notes.id, noteId))
				: eq(userNotes.userId, userId)
		);
}

export type UserNoteRow = Awaited<ReturnType<typeof selectUserNotes>>[number];

/** Converts a note row to JSON, with the encrypted content base64 encoded. */
export function toNoteJson(row: UserNoteRow) {
	return {
		...row,
		content: row.content ? (row.content as Buffer).toString('base64') : null
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

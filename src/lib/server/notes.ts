import { and, eq } from 'drizzle-orm';
import { db } from './db/index';
import { notes, userNotes } from './db/schema';

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
			content: notes.content,
			noteKey: userNotes.noteKey,
			permissions: userNotes.permissions,
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt,
			deletedAt: notes.deletedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
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

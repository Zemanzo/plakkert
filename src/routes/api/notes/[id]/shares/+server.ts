import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { user, userNotes } from '#lib/server/db/schema.js';
import { findOwnedNote } from '#lib/server/notes.js';
import { and, eq, ne } from 'drizzle-orm';

/** Lists who the note is shared with. Only the owner can see this. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const note = await findOwnedNote(params.id, locals.user.id);
	if (!note) throw error(404, 'Not found');

	const shares = await db
		.select({
			userId: userNotes.userId,
			username: user.username,
			permissions: userNotes.permissions
		})
		.from(userNotes)
		.innerJoin(user, eq(userNotes.userId, user.id))
		.where(and(eq(userNotes.noteId, params.id), ne(userNotes.userId, locals.user.id)))
		.orderBy(user.username);

	return Response.json(shares);
};

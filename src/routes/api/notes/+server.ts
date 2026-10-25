import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { notes, userNotes } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const results = await db
		.select({
			id: notes.id,
			content: notes.content,
			noteKey: userNotes.noteKey,
			permissions: userNotes.permissions,
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt,
			deletedAt: notes.deletedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.where(eq(userNotes.userId, locals.user.id));

	return Response.json(
		results.map((r) => ({
			...r,
			content: r.content ? (r.content as Buffer).toString('base64') : null
		}))
	);
};

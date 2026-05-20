import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { notes, userNotes } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [result] = await db
		.select({
			id: notes.id,
			content: notes.content,
			noteKey: userNotes.noteKey,
			permissions: userNotes.permissions,
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.where(and(eq(notes.id, params.id), eq(userNotes.userId, locals.user.id)));

	if (!result) throw error(404, 'Not found');

	return json({
		...result,
		content: result.content ? (result.content as Buffer).toString('base64') : null
	});
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [userNote] = await db
		.select({ permissions: userNotes.permissions })
		.from(userNotes)
		.where(and(eq(userNotes.noteId, params.id), eq(userNotes.userId, locals.user.id)));

	if (!userNote) throw error(404, 'Not found');
	if (userNote.permissions !== 'edit') throw error(403, 'Forbidden');

	let body: { content?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const { content } = body;
	if (typeof content !== 'string') throw error(400, 'content is required');

	const contentBuffer = Buffer.from(content, 'base64');

	const [updated] = await db
		.update(notes)
		.set({ content: contentBuffer, updatedAt: new Date() })
		.where(eq(notes.id, params.id))
		.returning({ id: notes.id, updatedAt: notes.updatedAt });

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [note] = await db
		.select({ owner: notes.owner })
		.from(notes)
		.where(eq(notes.id, params.id));

	if (!note) throw error(404, 'Not found');
	if (note.owner !== locals.user.id) throw error(403, 'Forbidden');

	await db.delete(notes).where(eq(notes.id, params.id));

	return new Response(null, { status: 204 });
};

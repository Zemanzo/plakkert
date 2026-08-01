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

	let body: { content?: unknown; noteKey?: unknown; createdAt?: unknown; updatedAt?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const { content, noteKey, updatedAt, createdAt } = body;
	if (typeof content !== 'string') throw error(400, 'content is required');
	if (typeof updatedAt !== 'number') throw error(400, 'updatedAt is required');

	const updatedAtDate = new Date(updatedAt);

	const contentBuffer = Buffer.from(content, 'base64');

	const [userNote] = await db
		.select({ permissions: userNotes.permissions })
		.from(userNotes)
		.where(and(eq(userNotes.noteId, params.id), eq(userNotes.userId, locals.user.id)));

	if (!userNote) {
		const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, params.id));
		if (existing) throw error(404, 'Not found');
		if (typeof noteKey !== 'string') {
			throw error(400, 'noteKey is required when creating a note');
		}
		if (typeof createdAt !== 'number') throw error(400, 'createdAt is required');

		const [created] = await db
			.insert(notes)
			.values({
				id: params.id,
				owner: locals.user.id,
				content: contentBuffer,
				createdAt: new Date(createdAt),
				updatedAt: updatedAtDate
			})
			.returning({ id: notes.id, updatedAt: notes.updatedAt });

		await db.insert(userNotes).values({
			userId: locals.user.id,
			noteId: created.id,
			noteKey,
			permissions: 'edit'
		});

		return json(created);
	}

	if (userNote.permissions !== 'edit') throw error(403, 'Forbidden');

	const [updated] = await db
		.update(notes)
		.set({ content: contentBuffer, updatedAt: updatedAtDate })
		.where(eq(notes.id, params.id))
		.returning({ id: notes.id, updatedAt: notes.updatedAt });

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [note] = await db.select({ owner: notes.owner }).from(notes).where(eq(notes.id, params.id));

	if (!note) throw error(404, 'Not found');
	if (note.owner !== locals.user.id) throw error(403, 'Forbidden');

	await db.delete(notes).where(eq(notes.id, params.id));

	return new Response(null, { status: 204 });
};

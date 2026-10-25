import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { notes, userNotes } from '#lib/server/db/schema.js';
import { selectUserNotes, toNoteJson } from '#lib/server/notes.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [result] = await selectUserNotes(locals.user.id, params.id);

	if (!result) throw error(404, 'Not found');

	return Response.json(toNoteJson(result));
};

/**
 * Creates or updates a note. Updates follow last-write-wins on `updatedAt`: an
 * update that is not newer than the stored note is rejected with 409, along
 * with the stored note so the client can take it instead.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

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

	// better-sqlite3 transactions are synchronous, so the checks and the write can't interleave
	// with another request for the same note.
	const result = db.transaction((tx) => {
		const [userNote] = selectUserNotes(userId, params.id, tx).all();

		if (!userNote) {
			const existing = tx.select({ id: notes.id }).from(notes).where(eq(notes.id, params.id)).get();
			if (existing) return { status: 404 } as const;
			if (typeof noteKey !== 'string')
				return { status: 400, message: 'noteKey is required when creating a note' } as const;
			if (typeof createdAt !== 'number')
				return { status: 400, message: 'createdAt is required' } as const;

			const created = tx
				.insert(notes)
				.values({
					id: params.id,
					owner: userId,
					content: contentBuffer,
					createdAt: new Date(createdAt),
					updatedAt: updatedAtDate
				})
				.returning({ id: notes.id, updatedAt: notes.updatedAt })
				.get();

			tx.insert(userNotes)
				.values({
					userId,
					noteId: created.id,
					noteKey,
					permissions: 'edit'
				})
				.run();

			return { status: 200, note: created } as const;
		}

		if (userNote.deletedAt) return { status: 410, note: userNote } as const;
		if (userNote.permissions !== 'edit') return { status: 403 } as const;
		if (updatedAtDate <= userNote.updatedAt) return { status: 409, note: userNote } as const;

		const updated = tx
			.update(notes)
			.set({ content: contentBuffer, updatedAt: updatedAtDate })
			.where(eq(notes.id, params.id))
			.returning({ id: notes.id, updatedAt: notes.updatedAt })
			.get();

		return { status: 200, note: updated } as const;
	});

	switch (result.status) {
		case 200:
			return Response.json(result.note);
		case 409:
		case 410:
			return Response.json(toNoteJson(result.note), { status: result.status });
		case 400:
			throw error(400, result.message);
		case 403:
			throw error(403, 'Forbidden');
		case 404:
			throw error(404, 'Not found');
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [note] = await db
		.select({ owner: notes.owner, deletedAt: notes.deletedAt })
		.from(notes)
		.where(eq(notes.id, params.id));

	if (!note) throw error(404, 'Not found');
	if (note.owner !== locals.user.id) throw error(403, 'Forbidden');
	// Deleting twice is fine, e.g. when a client retries after losing the response.
	if (note.deletedAt) return new Response(null, { status: 204 });

	const now = new Date();
	await db
		.update(notes)
		.set({ content: null, deletedAt: now, updatedAt: now })
		.where(eq(notes.id, params.id));

	return new Response(null, { status: 204 });
};

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { userNotes } from '#lib/server/db/schema.js';
import { selectUserNotes, toNoteJson } from '#lib/server/notes.js';
import { and, eq } from 'drizzle-orm';

/** Tags are a short encrypted list, so anything much bigger is a mistake or abuse. */
const MAX_TAGS_BYTES = 64 * 1024;

/**
 * Replaces the user's tags for a note. Tags are per user, so anyone with
 * access to the note can change their own, including view-only users. Like
 * note content, they follow last-write-wins on `updatedAt`: an update that is
 * not newer than the stored tags is rejected with 409, along with the stored
 * note so the client can take its tags instead.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	let body: { tags?: unknown; updatedAt?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const { tags, updatedAt } = body;
	if (typeof tags !== 'string') throw error(400, 'tags is required');
	if (typeof updatedAt !== 'number') throw error(400, 'updatedAt is required');

	const tagsBuffer = Buffer.from(tags, 'base64');
	if (tagsBuffer.length > MAX_TAGS_BYTES) throw error(413, 'Too many tags');
	const updatedAtDate = new Date(updatedAt);

	const result = db.transaction((tx) => {
		const [userNote] = selectUserNotes(userId, params.id, tx).all();

		if (!userNote) return { status: 404 } as const;
		if (userNote.deletedAt) return { status: 410, note: userNote } as const;
		if (userNote.tagsUpdatedAt && updatedAtDate <= userNote.tagsUpdatedAt) {
			return { status: 409, note: userNote } as const;
		}

		tx.update(userNotes)
			.set({ tags: tagsBuffer, tagsUpdatedAt: updatedAtDate })
			.where(and(eq(userNotes.noteId, params.id), eq(userNotes.userId, userId)))
			.run();

		return { status: 200 } as const;
	});

	switch (result.status) {
		case 200:
			return Response.json({ id: params.id, tagsUpdatedAt: updatedAtDate });
		case 409:
		case 410:
			return Response.json(toNoteJson(result.note), { status: result.status });
		case 404:
			throw error(404, 'Not found');
	}
};

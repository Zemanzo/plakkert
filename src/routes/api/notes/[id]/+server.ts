import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { notes, userNotes } from '#lib/server/db/schema.js';
import {
	changeStamp,
	selectUserNotes,
	toNoteJson,
	writeNote,
	writeResultJson
} from '#lib/server/notes.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [result] = await selectUserNotes(locals.user.id, params.id);

	if (!result) throw error(404, 'Not found');

	return Response.json(toNoteJson(result));
};

/** Creates or updates a note. See `writeNote`. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const result = db.transaction((tx) => writeNote(tx, userId, params.id, body));
	return Response.json(writeResultJson(result), { status: result.status });
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
	db.transaction((tx) => {
		const changedAt = changeStamp();
		tx.update(notes)
			.set({ content: null, deletedAt: now, updatedAt: now, changedAt })
			.where(eq(notes.id, params.id))
			.run();
		// Everyone's tags are encrypted with the note key too, so they go along with the content.
		tx.update(userNotes)
			.set({ tags: null, tagsUpdatedAt: null, changedAt })
			.where(eq(userNotes.noteId, params.id))
			.run();
	});

	return new Response(null, { status: 204 });
};

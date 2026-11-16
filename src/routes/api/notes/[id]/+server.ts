import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import {
	deleteNote,
	selectUserNotes,
	toNoteJson,
	writeNote,
	writeResultJson
} from '#lib/server/notes.js';

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

/** Deletes a note the user owns. See `deleteNote`. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	const { status } = db.transaction((tx) => deleteNote(tx, userId, params.id));
	if (status === 404) throw error(404, 'Not found');
	if (status === 403) throw error(403, 'Forbidden');
	return new Response(null, { status });
};

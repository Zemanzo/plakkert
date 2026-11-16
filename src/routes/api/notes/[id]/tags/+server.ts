import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { writeResultJson, writeTags } from '#lib/server/notes.js';

/** Replaces the user's tags for a note. See `writeTags`. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const result = db.transaction((tx) => writeTags(tx, userId, params.id, body));
	return Response.json(writeResultJson(result), { status: result.status });
};

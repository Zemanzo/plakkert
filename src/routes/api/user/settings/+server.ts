import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { writeSettings } from '#lib/server/settings.js';

/**
 * Replaces the user's settings, which sync across their devices. See
 * `writeSettings`. They're fetched along with the notes, from `/api/notes/changes`.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const result = db.transaction((tx) => writeSettings(tx, userId, body));
	return Response.json(result.body, { status: result.status });
};

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { historySince, setHistoryEnabled } from '#lib/server/history.js';

/** Since when the user keeps the history of their notes, or null when they don't. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	return Response.json({ since: historySince(locals.user.id) });
};

/** Turns note history on or off. Off deletes the history of all the user's notes. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
	if (typeof body?.enabled !== 'boolean') throw error(400, 'enabled is required');
	return Response.json({ since: setHistoryEnabled(locals.user.id, body.enabled) });
};

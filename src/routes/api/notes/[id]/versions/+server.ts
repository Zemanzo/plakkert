import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listVersions } from '#lib/server/history.js';

/**
 * The earlier versions of a note that the user may see, encrypted with the note key, and since
 * when its owner keeps its history (null, without versions, when they don't). See `listVersions`.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const result = listVersions(locals.user.id, params.id);
	if (!result) throw error(404, 'Not found');
	return Response.json(result);
};

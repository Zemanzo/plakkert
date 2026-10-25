import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectUserNotes, toNoteJson } from '#lib/server/notes.js';

/** Lists all notes of the user, including tombstones of deleted notes so deletions can sync. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const results = await selectUserNotes(locals.user.id);

	return Response.json(results.map(toNoteJson));
};

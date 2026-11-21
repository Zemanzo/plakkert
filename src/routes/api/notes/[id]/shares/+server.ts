import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findOwnedNote, listShares } from '#lib/server/notes.js';

/** Lists who the note is shared with. Only the owner can see this. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const note = await findOwnedNote(params.id, locals.user.id);
	if (!note) throw error(404, 'Not found');

	return Response.json(listShares(params.id, locals.user.id));
};

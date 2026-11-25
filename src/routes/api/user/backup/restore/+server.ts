import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restoreUpload } from '#lib/server/backup.js';

/** Restores an uploaded backup into the user's account, merging it. See `restoreBackup`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let body: { upload?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	if (typeof body.upload !== 'string') throw error(400, 'upload is required');

	const result = restoreUpload(body.upload, locals.user.id);
	return result.status === 200
		? Response.json(result.summary)
		: Response.json({ message: result.message, code: result.code }, { status: result.status });
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	return json({
		id: locals.user.id,
		username: locals.user.username,
		email: locals.user.email,
		publicKey: locals.user.publicKey
	});
};

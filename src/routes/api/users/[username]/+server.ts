import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/** Looks up another user's public key, so a note key can be encrypted for them when sharing. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [result] = await db
		.select({ id: user.id, username: user.username, publicKey: user.publicKey })
		.from(user)
		.where(eq(user.username, params.username.toLowerCase()));

	if (!result) throw error(404, 'Not found');

	return Response.json(result);
};

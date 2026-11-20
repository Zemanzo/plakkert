import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromApp } from '#lib/server/mcp/http.js';
import { revokeGrant } from '#lib/server/mcp/oauth.js';

export const prerender = false;

/** Revokes a client's access to the user's notes. */
export const DELETE: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!fromApp(request)) throw error(403, 'Forbidden');
	if (!revokeGrant(locals.user.id, params.id)) throw error(404, 'Not found');
	return new Response(null, { status: 204 });
};

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromApp } from '#lib/server/mcp/http.js';
import { parseGrantAccess, revokeGrant, updateGrantAccess } from '#lib/server/mcp/oauth.js';

export const prerender = false;

/**
 * Changes what a client may do, from its next request on. The tags of its filter come encrypted
 * with the user's public key, by their browser.
 */
export const PUT: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!fromApp(request)) throw error(403, 'Forbidden');
	const body = (await request.json().catch(() => null)) as {
		permissions?: unknown;
		tagFilter?: unknown;
	} | null;
	const access = body && parseGrantAccess(body.permissions, body.tagFilter);
	if (!access) throw error(400, 'Invalid permissions');
	if (!updateGrantAccess(locals.user.id, params.id, access)) throw error(404, 'Not found');
	return new Response(null, { status: 204 });
};

/** Revokes a client's access to the user's notes. */
export const DELETE: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!fromApp(request)) throw error(403, 'Forbidden');
	if (!revokeGrant(locals.user.id, params.id)) throw error(404, 'Not found');
	return new Response(null, { status: 204 });
};

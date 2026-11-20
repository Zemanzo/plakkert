import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromApp, json } from '#lib/server/mcp/http.js';
import { isMcpEnabled, listGrants, setMcpEnabled } from '#lib/server/mcp/oauth.js';

export const prerender = false;

/** Whether MCP clients may read the user's notes, and which clients they approved. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	return json({ enabled: isMcpEnabled(locals.user.id), clients: listGrants(locals.user.id) });
};

/** Turns MCP access on or off. Off revokes every client's access. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!fromApp(request)) throw error(403, 'Forbidden');
	const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
	if (typeof body?.enabled !== 'boolean') throw error(400, 'Invalid request');
	setMcpEnabled(locals.user.id, body.enabled);
	return json({ enabled: body.enabled, clients: listGrants(locals.user.id) });
};

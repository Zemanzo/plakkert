import type { RequestHandler } from './$types';
import { json, tooManyRequests } from '#lib/server/mcp/http.js';
import { registerClient } from '#lib/server/mcp/oauth.js';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';

export const prerender = false;

// Anyone can register a client, which can't do anything until a user approves it. Limited, so
// nobody can fill the database with them.
const allowed = rateLimiter(20, 60 * 60 * 1000);

/** Dynamic Client Registration (RFC 7591), which MCP clients such as Claude use. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!allowed(getClientAddress())) return tooManyRequests();
	const body = await request.json().catch(() => null);
	const result = registerClient(body);
	return json(result.body, result.status);
};

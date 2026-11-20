import type { RequestHandler } from './$types';
import { json, origin, tooManyRequests } from '#lib/server/mcp/http.js';
import { exchangeToken } from '#lib/server/mcp/oauth.js';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';

export const prerender = false;

const allowed = rateLimiter(60, 60 * 1000);

/**
 * The OAuth token endpoint. Clients post a form, usually from their own servers, without an
 * Origin header, which is why it's exempt from the CSRF check in hooks.server.ts: it doesn't use
 * cookies, only the code or refresh token it's given.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!allowed(getClientAddress())) return tooManyRequests();
	if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
		return json({ error: 'invalid_request', error_description: 'Send a form' }, 400);
	}
	const form = new URLSearchParams(await request.text());
	const result = await exchangeToken(form, origin());
	return json(result.body, result.status);
};

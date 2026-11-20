import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromApp, json, origin } from '#lib/server/mcp/http.js';
import { approve, checkAuthorizeRequest, isMcpEnabled } from '#lib/server/mcp/oauth.js';

export const prerender = false;

/**
 * Checks an authorization request for the app's authorize page, at /oauth/authorize, which shows
 * it to the signed-in user. Takes the request's query string as is.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const result = checkAuthorizeRequest(url.searchParams, origin());
	if (!result.ok) return json(result);
	const { request } = result;
	return json({
		ok: true,
		clientName: request.clientName,
		redirectUri: request.redirectUri,
		state: request.state,
		issuer: origin(),
		mcpEnabled: isMcpEnabled(locals.user.id)
	});
};

const SECRET_HASH = /^[A-Za-z0-9_-]{43}$/;
/** A secretbox nonce, the 32-byte private key and the tag. */
const WRAPPED_KEY_LENGTH = 24 + 32 + 16;

/**
 * Approves the request. The body has the query string again, which is checked again, and the
 * user's private key, encrypted by their browser with a secret that only ends up in the code.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!fromApp(request)) throw error(403, 'Forbidden');
	const body = (await request.json().catch(() => null)) as {
		query?: unknown;
		wrappedKey?: unknown;
		secretHash?: unknown;
	} | null;
	if (
		typeof body?.query !== 'string' ||
		typeof body.wrappedKey !== 'string' ||
		typeof body.secretHash !== 'string' ||
		!SECRET_HASH.test(body.secretHash)
	) {
		throw error(400, 'Invalid request');
	}
	const wrappedKey = Buffer.from(body.wrappedKey, 'base64');
	if (wrappedKey.length !== WRAPPED_KEY_LENGTH) throw error(400, 'Invalid key');

	const result = checkAuthorizeRequest(new URLSearchParams(body.query), origin());
	if (!result.ok) return json(result, 400);
	const approval = approve(locals.user.id, result.request, wrappedKey, body.secretHash);
	if (!approval.ok) return json({ ok: false, description: approval.description }, 409);
	return json({ ok: true, codeId: approval.codeId });
};

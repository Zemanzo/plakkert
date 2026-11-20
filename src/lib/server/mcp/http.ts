import { ORIGIN } from '$app/env/private';
import { MCP_SCOPE } from '#lib/mcp.js';

/**
 * The app's public origin, e.g. https://plakkert.example.com. OAuth metadata, token audiences and
 * redirects are all based on it, never on the request's Host header, which a client could set.
 */
export function origin() {
	if (!ORIGIN) throw new Error('Set ORIGIN to the app’s public URL to use MCP');
	return ORIGIN.replace(/\/$/, '');
}

/** Where MCP clients find out how to get a token for the MCP endpoint (RFC 9728). */
export const resourceMetadataUrl = () => `${origin()}/.well-known/oauth-protected-resource/mcp`;

/** Tokens and anything with notes in it must never be stored by a cache along the way. */
export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
	return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** A 401 that tells MCP clients where to sign in (RFC 9728 and RFC 6750). */
export function unauthorized(invalidToken: boolean) {
	const params = [
		`resource_metadata="${resourceMetadataUrl()}"`,
		`scope="${MCP_SCOPE}"`,
		...(invalidToken ? ['error="invalid_token"'] : [])
	];
	return json(
		{
			error: invalidToken ? 'invalid_token' : 'unauthorized',
			error_description: invalidToken
				? 'The access token is invalid or expired, or MCP access was turned off'
				: 'Sign in with OAuth to use this MCP server'
		},
		401,
		{ 'WWW-Authenticate': `Bearer ${params.join(', ')}` }
	);
}

export const tooManyRequests = () =>
	json({ error: 'too_many_requests', error_description: 'Too many requests' }, 429, {
		'Retry-After': '60'
	});

/**
 * Whether a request comes from the app itself. Required for changes made with the user's session
 * cookie, such as approving a client, so another site can't make them on the user's behalf.
 */
export const fromApp = (request: Request) => request.headers.get('origin') === origin();

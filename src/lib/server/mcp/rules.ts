import { createHash } from 'node:crypto';
import { MCP_PATH, MCP_SCOPE } from '#lib/mcp.js';

// The rules of the OAuth flow that don't need the database, so they can be tested on their own.
// OAuth 2.1 with PKCE, as the MCP specification asks for; see `oauth.ts`.

export const CODE_TTL_MS = 2 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The URL of the MCP endpoint, which tokens are for (their audience). */
export const mcpResource = (origin: string) => origin + MCP_PATH;

const MAX_REDIRECT_URIS = 5;
const MAX_URI_LENGTH = 2000;
const MAX_CLIENT_NAME_LENGTH = 100;
/** Schemes that would run or show something in the browser, rather than reach the client. */
const UNSAFE_SCHEMES = new Set([
	'javascript:',
	'data:',
	'file:',
	'blob:',
	'about:',
	'vbscript:',
	'filesystem:',
	'ws:',
	'wss:',
	'ftp:'
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(value: string) {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

/**
 * Returns why a client may not use a redirect URI, or null if it may. Allowed are HTTPS URLs,
 * HTTP on this computer (for apps such as Claude Code, RFC 8252), and an app's own scheme, such as
 * `cursor://`. Never with a fragment, which OAuth forbids.
 */
export function redirectUriProblem(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > MAX_URI_LENGTH) return 'Invalid redirect URI';
	const url = parseUrl(value);
	if (!url) return 'Invalid redirect URI';
	if (url.hash || value.includes('#')) return 'Redirect URIs can’t have a fragment';
	if (url.username || url.password) return 'Redirect URIs can’t have credentials';
	if (url.protocol === 'https:') return url.hostname ? null : 'Invalid redirect URI';
	if (url.protocol === 'http:') {
		return isLoopback(url) ? null : 'Redirect URIs must use HTTPS, except on localhost';
	}
	if (UNSAFE_SCHEMES.has(url.protocol)) return 'This kind of redirect URI isn’t allowed';
	return null;
}

/**
 * Whether a redirect URI is one of the client's. They must be the same, except that the port of
 * a loopback URI may differ, as apps on the user's computer listen on whichever port is free.
 */
export function redirectUriMatches(registered: readonly string[], requested: string) {
	if (registered.includes(requested)) return true;
	const url = parseUrl(requested);
	if (!url || !isLoopback(url)) return false;
	return registered.some((uri) => {
		const candidate = parseUrl(uri);
		return (
			!!candidate &&
			isLoopback(candidate) &&
			candidate.hostname === url.hostname &&
			candidate.pathname === url.pathname &&
			candidate.search === url.search
		);
	});
}

export interface ClientRegistration {
	name: string;
	redirectUris: string[];
}

/**
 * Checks a client's registration (RFC 7591). Only public clients are supported: MCP clients run
 * on users' computers or as services without a secret of ours, and PKCE protects their codes.
 */
export function parseClientRegistration(
	body: unknown
): { ok: true; client: ClientRegistration } | { ok: false; error: string; description: string } {
	const invalid = (error: string, description: string) => ({
		ok: false as const,
		error,
		description
	});
	if (typeof body !== 'object' || body === null) {
		return invalid('invalid_client_metadata', 'Expected a JSON object');
	}
	const metadata = body as Record<string, unknown>;
	const uris = metadata.redirect_uris;
	if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
		return invalid('invalid_redirect_uri', `Give between 1 and ${MAX_REDIRECT_URIS} redirect URIs`);
	}
	for (const uri of uris) {
		const problem = redirectUriProblem(uri);
		if (problem) return invalid('invalid_redirect_uri', problem);
	}
	const authMethod = metadata.token_endpoint_auth_method ?? 'none';
	if (authMethod !== 'none') {
		return invalid('invalid_client_metadata', 'Only public clients (“none”) are supported');
	}
	const grantTypes = metadata.grant_types ?? ['authorization_code'];
	if (
		!Array.isArray(grantTypes) ||
		!grantTypes.every((type) => type === 'authorization_code' || type === 'refresh_token')
	) {
		return invalid('invalid_client_metadata', 'Unsupported grant types');
	}
	const responseTypes = metadata.response_types ?? ['code'];
	if (!Array.isArray(responseTypes) || !responseTypes.every((type) => type === 'code')) {
		return invalid('invalid_client_metadata', 'Unsupported response types');
	}
	const name =
		typeof metadata.client_name === 'string'
			? // eslint-disable-next-line no-control-regex
				metadata.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
			: '';
	return {
		ok: true,
		client: {
			name: name.slice(0, MAX_CLIENT_NAME_LENGTH) || 'Unnamed app',
			redirectUris: uris as string[]
		}
	};
}

/** Whether a requested scope is allowed. Without one, clients get the one scope there is. */
export function parseScope(scope: string | null) {
	if (scope === null || scope.trim() === '') return MCP_SCOPE;
	const scopes = scope.split(' ').filter(Boolean);
	return scopes.every((s) => s === MCP_SCOPE) ? MCP_SCOPE : null;
}

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isPkceChallenge = (challenge: string | null): challenge is string =>
	challenge !== null && PKCE_CHALLENGE.test(challenge);

/** Checks a PKCE code verifier against the challenge the client sent first (S256 only). */
export function pkceMatches(verifier: string | null, challenge: string) {
	if (verifier === null || !PKCE_VERIFIER.test(verifier)) return false;
	return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

/**
 * Whether a requested resource (RFC 8707) is this server's MCP endpoint. Clients should send it;
 * without one, tokens are still only for the MCP endpoint.
 */
export function resourceMatches(resource: string | null, origin: string) {
	if (resource === null) return true;
	const expected = mcpResource(origin);
	// The trailing slash makes no difference to which endpoint is meant.
	return resource === expected || resource === `${expected}/`;
}

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	parseClientRegistration,
	parseScope,
	pkceMatches,
	redirectUriMatches,
	redirectUriProblem,
	resourceMatches
} from './rules';

describe('redirect URIs', () => {
	it('allows HTTPS, HTTP on this computer, and apps’ own schemes', () => {
		expect(redirectUriProblem('https://claude.ai/api/mcp/auth_callback')).toBeNull();
		expect(redirectUriProblem('http://localhost:3118/callback')).toBeNull();
		expect(redirectUriProblem('http://127.0.0.1:8080/cb')).toBeNull();
		expect(redirectUriProblem('http://[::1]/cb')).toBeNull();
		expect(redirectUriProblem('cursor://anysphere.cursor-mcp/oauth/callback')).toBeNull();
	});

	it('refuses anything that could reach someone else or run in the browser', () => {
		expect(redirectUriProblem('http://example.com/cb')).not.toBeNull();
		expect(redirectUriProblem('http://localhost.evil.com/cb')).not.toBeNull();
		expect(redirectUriProblem('javascript:alert(1)')).not.toBeNull();
		expect(redirectUriProblem('data:text/html,hi')).not.toBeNull();
		expect(redirectUriProblem('https://example.com/cb#frag')).not.toBeNull();
		expect(redirectUriProblem('https://user:pass@example.com/cb')).not.toBeNull();
		expect(redirectUriProblem('not a url')).not.toBeNull();
		expect(redirectUriProblem(42)).not.toBeNull();
	});

	it('must match exactly, except for the port on this computer', () => {
		const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'];
		expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
		expect(redirectUriMatches(registered, 'http://localhost:51234/callback')).toBe(true);
		expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
		expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/other')).toBe(false);
		expect(redirectUriMatches(registered, 'http://localhost:51234/other')).toBe(false);
		expect(redirectUriMatches(registered, 'http://127.0.0.1:51234/callback')).toBe(false);
		expect(redirectUriMatches(registered, 'https://localhost:51234/callback')).toBe(false);
	});
});

describe('client registration', () => {
	it('accepts public clients', () => {
		const result = parseClientRegistration({
			client_name: 'Claude\u0000',
			redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		});
		expect(result).toEqual({
			ok: true,
			client: { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] }
		});
	});

	it('refuses confidential clients, other grants and bad redirect URIs', () => {
		const base = { redirect_uris: ['https://example.com/cb'] };
		expect(
			parseClientRegistration({ ...base, token_endpoint_auth_method: 'client_secret_basic' }).ok
		).toBe(false);
		expect(parseClientRegistration({ ...base, grant_types: ['client_credentials'] }).ok).toBe(
			false
		);
		expect(parseClientRegistration({ ...base, response_types: ['token'] }).ok).toBe(false);
		expect(parseClientRegistration({ redirect_uris: [] }).ok).toBe(false);
		expect(parseClientRegistration({ redirect_uris: ['http://example.com/cb'] }).ok).toBe(false);
		expect(parseClientRegistration(null).ok).toBe(false);
	});

	it('names nameless clients', () => {
		const result = parseClientRegistration({ redirect_uris: ['https://example.com/cb'] });
		expect(result.ok && result.client.name).toBe('Unnamed app');
	});
});

describe('scope, PKCE and resource', () => {
	it('only has the notes scope, also by its old name', () => {
		expect(parseScope(null)).toBe('notes');
		expect(parseScope('notes')).toBe('notes');
		// From when apps could only read.
		expect(parseScope('notes:read')).toBe('notes');
		expect(parseScope('notes notes:write')).toBeNull();
	});

	it('checks the PKCE verifier against the S256 challenge', () => {
		const verifier = 'a'.repeat(43) + '-._~';
		const challenge = createHash('sha256').update(verifier).digest('base64url');
		expect(pkceMatches(verifier, challenge)).toBe(true);
		expect(pkceMatches(verifier + 'x', challenge)).toBe(false);
		expect(pkceMatches('short', challenge)).toBe(false);
		expect(pkceMatches(null, challenge)).toBe(false);
	});

	it('only issues tokens for this server’s MCP endpoint', () => {
		const origin = 'https://notes.example.com';
		expect(resourceMatches(null, origin)).toBe(true);
		expect(resourceMatches('https://notes.example.com/mcp', origin)).toBe(true);
		expect(resourceMatches('https://notes.example.com/mcp/', origin)).toBe(true);
		expect(resourceMatches('https://notes.example.com', origin)).toBe(false);
		expect(resourceMatches('https://evil.example.com/mcp', origin)).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import { isMcpPath } from './paths';

describe('MCP paths', () => {
	it('cover the MCP endpoint, OAuth and MCP settings', () => {
		for (const path of [
			'/mcp',
			'/mcp/',
			'/.well-known/oauth-protected-resource',
			'/.well-known/oauth-protected-resource/mcp',
			'/.well-known/oauth-authorization-server',
			'/api/oauth/token',
			'/api/oauth/register',
			'/api/oauth/authorize',
			'/api/mcp/access',
			'/api/mcp/clients/abc'
		]) {
			expect(isMcpPath(path), path).toBe(true);
		}
	});

	it('leave the rest of the app alone', () => {
		for (const path of ['/mcpx', '/api/notes', '/api/user/settings', '/api/auth/sign-in', '/']) {
			expect(isMcpPath(path), path).toBe(false);
		}
	});
});

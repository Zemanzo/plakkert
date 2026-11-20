import { MCP_PATH } from '#lib/mcp.js';

/**
 * Whether a request is for MCP or the OAuth that MCP clients sign in with. None of these exist
 * while the MCP environment variable is off (see hooks.server.ts).
 */
export function isMcpPath(pathname: string) {
	return (
		pathname === MCP_PATH ||
		pathname.startsWith(`${MCP_PATH}/`) ||
		pathname.startsWith('/.well-known/oauth-') ||
		pathname.startsWith('/api/oauth/') ||
		pathname.startsWith('/api/mcp/')
	);
}

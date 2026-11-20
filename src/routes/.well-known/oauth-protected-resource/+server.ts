import { protectedResourceMetadata } from '#lib/server/mcp/metadata.js';

// The app's only protected resource is the MCP endpoint, so this is the same as under /mcp.
export const prerender = false;
export const GET = protectedResourceMetadata;

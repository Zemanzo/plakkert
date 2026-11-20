// Shared by the app and the server, for MCP access to a user's notes. See `src/lib/server/mcp/`.

/** The path of the MCP endpoint. */
export const MCP_PATH = '/mcp';

/** The only scope there is: reading the user's notes and tags. MCP clients can't change them. */
export const MCP_SCOPE = 'notes:read';

/**
 * Used to derive the key that encrypts a user's private key for a grant from the grant's secret,
 * so that key is only ever used for this.
 */
export const WRAP_KEY_CONTEXT = 'plakkert mcp grant key v1';

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestHandler } from './$types';
import { json, NO_STORE, origin, tooManyRequests, unauthorized } from '#lib/server/mcp/http.js';
import { forget } from '#lib/server/mcp/crypto.js';
import { authenticate } from '#lib/server/mcp/oauth.js';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';
import { createMcpServer } from '#lib/server/mcp/server.js';

export const prerender = false;

// The MCP endpoint (Streamable HTTP, stateless, with JSON responses). Every request needs an
// access token; see src/lib/server/mcp/oauth.ts. The caller's notes are decrypted for that request
// only, with the private key from their grant, which is forgotten afterwards.

const allowed = rateLimiter(120, 60 * 1000);

const handle: RequestHandler = async ({ request }) => {
	// Browsers send an Origin; MCP clients run outside them. A page elsewhere has no business here
	// (the MCP specification asks servers to check this, against DNS rebinding).
	const requestOrigin = request.headers.get('origin');
	if (requestOrigin && requestOrigin !== origin()) {
		return json({ error: 'forbidden', error_description: 'Not allowed from this origin' }, 403);
	}

	const authorization = request.headers.get('authorization');
	const caller = await authenticate(authorization, origin());
	if (!caller) return unauthorized(authorization !== null);

	try {
		if (!allowed(caller.grantId)) return tooManyRequests();
		const server = createMcpServer(caller);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true
		});
		await server.connect(transport);
		try {
			const response = await transport.handleRequest(request);
			// The whole response is there before it's returned, so the key can be forgotten.
			const body = await response.arrayBuffer();
			const headers = new Headers(response.headers);
			for (const [name, value] of Object.entries(NO_STORE)) headers.set(name, value);
			return new Response(body.byteLength > 0 ? body : null, {
				status: response.status,
				headers
			});
		} finally {
			await server.close();
		}
	} finally {
		await forget(caller.privateKey);
	}
};

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

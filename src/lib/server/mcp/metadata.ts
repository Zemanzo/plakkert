import { MCP_SCOPE } from '#lib/mcp.js';
import { json, origin } from './http';
import { mcpResource } from './rules';

/** Protected Resource Metadata (RFC 9728): the MCP endpoint, and who issues tokens for it. */
export function protectedResourceMetadata() {
	return json(
		{
			resource: mcpResource(origin()),
			authorization_servers: [origin()],
			scopes_supported: [MCP_SCOPE],
			bearer_methods_supported: ['header'],
			resource_name: 'Plakkert notes'
		},
		200,
		{ 'Access-Control-Allow-Origin': '*' }
	);
}

/**
 * Authorization Server Metadata (RFC 8414). Clients register themselves (RFC 7591); Client ID
 * Metadata Documents aren't supported, as fetching a URL a client names would let anyone make
 * this server send requests where they like.
 */
export function authorizationServerMetadata() {
	const base = origin();
	return json(
		{
			issuer: base,
			authorization_endpoint: `${base}/oauth/authorize`,
			token_endpoint: `${base}/api/oauth/token`,
			registration_endpoint: `${base}/api/oauth/register`,
			scopes_supported: [MCP_SCOPE],
			response_types_supported: ['code'],
			response_modes_supported: ['query'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			token_endpoint_auth_methods_supported: ['none'],
			code_challenge_methods_supported: ['S256'],
			authorization_response_iss_parameter_supported: true
		},
		200,
		{ 'Access-Control-Allow-Origin': '*' }
	);
}

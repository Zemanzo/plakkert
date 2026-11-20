import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, url } from './helpers';

// A minimal OAuth client, like the MCP clients that connect to the app (e.g. Claude), for the
// tests. It runs outside the browser, so its requests have no Origin header and no cookies.

/** Where the "client" is sent back to. Nothing listens there: the tests catch the redirect. */
export const REDIRECT_URI = 'http://127.0.0.1:9/callback';
export const MCP_URL = url('/mcp');

export function pkcePair() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

export async function registerClient(
	request: APIRequestContext,
	metadata: Record<string, unknown> = {}
) {
	const response = await request.post(url('/api/oauth/register'), {
		data: {
			client_name: 'Test client',
			redirect_uris: [REDIRECT_URI],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			...metadata
		}
	});
	expect(response.status()).toBe(201);
	return ((await response.json()) as { client_id: string }).client_id;
}

export function authorizeUrl(
	clientId: string,
	challenge: string,
	extra: Record<string, string> = {}
) {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		scope: 'notes:read',
		resource: MCP_URL,
		state: 'some-state',
		...extra
	});
	return url(`/oauth/authorize?${params}`);
}

/**
 * Catches where the app sends the user back to the client, as nothing listens there.
 *
 * @returns A function that waits for the redirect, and returns its query parameters.
 */
export async function catchRedirect(page: Page) {
	let resolveRedirect: (params: URLSearchParams) => void;
	const redirected = new Promise<URLSearchParams>((resolve) => (resolveRedirect = resolve));
	await page.route(`${new URL(REDIRECT_URI).origin}/**`, async (route) => {
		resolveRedirect(new URL(route.request().url()).searchParams);
		await route.fulfill({ body: 'Back at the client' });
	});
	return () => redirected;
}

/**
 * Goes through the authorize page as the signed-in user, and allows the client.
 *
 * @returns The authorization code.
 */
export async function authorize(page: Page, clientId: string, challenge: string) {
	const waitForRedirect = await catchRedirect(page);
	await page.goto(authorizeUrl(clientId, challenge));
	const turnOn = page.getByRole('button', { name: 'Turn on MCP access' });
	const allow = page.getByRole('button', { name: 'Allow' });
	await expect(turnOn.or(allow)).toBeVisible();
	if (await turnOn.isVisible()) await turnOn.click();
	await allow.click();
	const params = await waitForRedirect();
	expect(params.get('state')).toBe('some-state');
	expect(params.get('iss')).toBe(url('/').replace(/\/$/, ''));
	return params.get('code')!;
}

export function token(request: APIRequestContext, form: Record<string, string>) {
	return request.post(url('/api/oauth/token'), { form });
}

export async function exchangeCode(
	request: APIRequestContext,
	clientId: string,
	code: string,
	verifier: string
) {
	const response = await token(request, {
		grant_type: 'authorization_code',
		code,
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		code_verifier: verifier,
		resource: MCP_URL
	});
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
		scope: string;
	};
}

/** Registers a client and connects it to the signed-in user, as an MCP client would. */
export async function connect(page: Page, request: APIRequestContext) {
	const clientId = await registerClient(request);
	const { verifier, challenge } = pkcePair();
	const code = await authorize(page, clientId, challenge);
	return { clientId, ...(await exchangeCode(request, clientId, code, verifier)) };
}

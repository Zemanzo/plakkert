import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
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
		scope: 'notes',
		resource: MCP_URL,
		state: 'some-state',
		...extra
	});
	return url(`/oauth/authorize?${params}`);
}

/**
 * Catches where the app sends the user back to the client, as nothing listens there.
 *
 * @returns A function that waits for the redirect, and returns its query parameters. It waits
 *   until the page is at the client, too, so going elsewhere next doesn't cut that short.
 */
export async function catchRedirect(page: Page) {
	let resolveRedirect: (params: URLSearchParams) => void;
	const redirected = new Promise<URLSearchParams>((resolve) => (resolveRedirect = resolve));
	const client = `${new URL(REDIRECT_URI).origin}/**`;
	await page.route(client, async (route) => {
		resolveRedirect(new URL(route.request().url()).searchParams);
		await route.fulfill({ body: 'Back at the client' });
	});
	return async () => {
		const params = await redirected;
		await page.waitForURL(client);
		return params;
	};
}

/** What to allow a client, by the labels of the permissions editor. Left out: as it starts. */
export interface Access {
	read?: boolean;
	hidden?: boolean;
	tagMode?: 'include' | 'exclude';
	/** Tags to check in the filter. */
	tags?: string[];
	create?: boolean;
	edit?: boolean;
	delete?: boolean;
	organize?: boolean;
	share?: boolean;
	backup?: boolean;
}

/** Everything there is, but backups, which are a world of their own. */
export const FULL_ACCESS: Access = {
	read: true,
	hidden: true,
	create: true,
	edit: true,
	delete: true,
	organize: true,
	share: true
};

const LABELS: Record<Exclude<keyof Access, 'tagMode' | 'tags'>, RegExp> = {
	read: /^Read/,
	hidden: /^Also hidden notes/,
	create: /^Create notes/,
	edit: /^Edit/,
	delete: /^Delete/,
	organize: /^Tag, color, archive and hide/,
	share: /^Share/,
	backup: /^Backups/
};

/** Sets the permissions editor in `within` (the page, or a settings row) to `access`. */
export async function choosePermissions(within: Page | Locator, access: Access) {
	// Read first: without it, the others that need it can't be checked.
	for (const key of Object.keys(LABELS) as (keyof typeof LABELS)[]) {
		const value = access[key];
		if (value !== undefined) {
			await within.getByRole('checkbox', { name: LABELS[key] }).setChecked(value);
		}
	}
	if (access.tagMode) {
		await within
			.getByRole('combobox', { name: 'Include or exclude notes with these tags' })
			.selectOption(access.tagMode);
	}
	if (access.tags) {
		await within.locator('details.tagPicker summary').click();
		const list = within.getByRole('group', { name: 'Tags' });
		for (const tag of access.tags) {
			await list.getByRole('checkbox', { name: tag, exact: true }).check();
		}
		await within.locator('details.tagPicker summary').click();
	}
}

/**
 * Goes through the authorize page as the signed-in user, and allows the client what `access`
 * says, on top of what the page starts with (reading, without hidden notes).
 *
 * @returns The authorization code.
 */
export async function authorize(
	page: Page,
	clientId: string,
	challenge: string,
	access: Access = {}
) {
	const waitForRedirect = await catchRedirect(page);
	await page.goto(authorizeUrl(clientId, challenge));
	const turnOn = page.getByRole('button', { name: 'Turn on MCP access' });
	const allow = page.getByRole('button', { name: 'Allow' });
	await expect(turnOn.or(allow)).toBeVisible();
	if (await turnOn.isVisible()) await turnOn.click();
	await choosePermissions(page, access);
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

let nextId = 1;

/** Calls the MCP endpoint, like an MCP client would (JSON-RPC over Streamable HTTP). */
export function rpc(
	request: APIRequestContext,
	accessToken: string | null,
	method: string,
	params: Record<string, unknown> = {},
	headers: Record<string, string> = {}
) {
	return request.post(MCP_URL, {
		headers: {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
			...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
			...headers
		},
		data: { jsonrpc: '2.0', id: nextId++, method, params }
	});
}

export type ToolResult = {
	isError?: boolean;
	content: { text: string }[];
	structuredContent: Record<string, unknown>;
};

export async function callTool(
	request: APIRequestContext,
	accessToken: string,
	name: string,
	args: Record<string, unknown> = {}
) {
	const response = await rpc(request, accessToken, 'tools/call', { name, arguments: args });
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	return body.result as ToolResult;
}

/** The names of the tools a client has. */
export async function toolNames(request: APIRequestContext, accessToken: string) {
	const response = await rpc(request, accessToken, 'tools/list');
	expect(response.status()).toBe(200);
	const { tools } = (await response.json()).result as { tools: { name: string }[] };
	return tools.map((tool) => tool.name).sort();
}

export const titles = (result: { structuredContent: Record<string, unknown> }) =>
	(result.structuredContent.notes as { title: string }[]).map((note) => note.title).sort();

/** Registers a client and connects it to the signed-in user, as an MCP client would. */
export async function connect(
	page: Page,
	request: APIRequestContext,
	access: Access = {},
	clientName = 'Test client'
) {
	const clientId = await registerClient(request, { client_name: clientName });
	const { verifier, challenge } = pkcePair();
	const code = await authorize(page, clientId, challenge, access);
	return { clientId, ...(await exchangeCode(request, clientId, code, verifier)) };
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	UnauthorizedError,
	type OAuthClientProvider
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
	OAuthClientInformationMixed,
	OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { readFile } from 'node:fs/promises';
import type { APIRequestContext } from '@playwright/test';
import { addTag, expect, newNote, noteAction, test, uniqueName, url, waitSynced } from './helpers';
import { catchRedirect, connect, MCP_URL, REDIRECT_URI } from './mcpClient';

// What MCP clients can do with a user's notes, once connected (see oauth.test.ts): read them,
// only theirs, and only while the user allows it.

let nextId = 1;

/** Calls the MCP endpoint, like an MCP client would (JSON-RPC over Streamable HTTP). */
function rpc(
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

async function callTool(
	request: APIRequestContext,
	accessToken: string,
	name: string,
	args: Record<string, unknown> = {}
) {
	const response = await rpc(request, accessToken, 'tools/call', { name, arguments: args });
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	return body.result as {
		isError?: boolean;
		content: { text: string }[];
		structuredContent: Record<string, unknown>;
	};
}

const titles = (result: { structuredContent: Record<string, unknown> }) =>
	(result.structuredContent.notes as { title: string }[]).map((note) => note.title).sort();

test('an MCP client can search and read the user’s notes, and nothing else', async ({
	app,
	request
}) => {
	const alice = await app.register(uniqueName('alice'));
	await newNote(alice.page, 'Alice groceries: milk');
	await newNote(alice.page, 'Alice archived plan');
	await newNote(alice.page, 'Alice thrown away');
	await addTag(alice.page, 'groceries', 'Shopping');
	await noteAction(alice.page, 'archived plan', 'Archive');
	await noteAction(alice.page, 'thrown away', 'Move to trash');
	await waitSynced(alice.page);

	const bob = await app.register(uniqueName('bob'));
	await newNote(bob.page, 'Bob secret diary');
	await waitSynced(bob.page);

	const aliceClient = await connect(alice.page, request);
	const bobClient = await connect(bob.page, request);

	await test.step('it has read-only tools', async () => {
		const response = await rpc(request, aliceClient.access_token, 'tools/list');
		expect(response.headers()['cache-control']).toBe('no-store');
		const { tools } = (await response.json()).result as {
			tools: { name: string; annotations: { readOnlyHint: boolean } }[];
		};
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'get_note',
			'list_tags',
			'search_notes'
		]);
		for (const tool of tools) expect(tool.annotations.readOnlyHint).toBe(true);
	});

	await test.step('it finds the user’s notes, without the trash unless asked', async () => {
		const all = await callTool(request, aliceClient.access_token, 'search_notes');
		expect(titles(all)).toEqual(['Alice archived plan', 'Alice groceries: milk']);
		const withTrash = await callTool(request, aliceClient.access_token, 'search_notes', {
			include_trashed: true
		});
		expect(titles(withTrash)).toHaveLength(3);
		const search = await callTool(request, aliceClient.access_token, 'search_notes', {
			query: 'MILK'
		});
		expect(titles(search)).toEqual(['Alice groceries: milk']);
		const tagged = await callTool(request, aliceClient.access_token, 'search_notes', {
			tag: 'shopping'
		});
		expect(titles(tagged)).toEqual(['Alice groceries: milk']);
	});

	await test.step('it reads whole notes and lists tags', async () => {
		const found = await callTool(request, aliceClient.access_token, 'search_notes', {
			query: 'groceries'
		});
		const [{ id }] = found.structuredContent.notes as { id: string }[];
		const note = await callTool(request, aliceClient.access_token, 'get_note', { id });
		expect(note.structuredContent).toMatchObject({
			title: 'Alice groceries: milk',
			markdown: 'Alice groceries: milk',
			tags: ['Shopping'],
			archived: false,
			shared_by: null
		});
		const tags = await callTool(request, aliceClient.access_token, 'list_tags');
		expect(tags.structuredContent).toEqual({ tags: [{ name: 'Shopping', count: 1 }] });

		// Another user's token can't read it, even with its id.
		const asBob = await callTool(request, bobClient.access_token, 'get_note', { id });
		expect(asBob.isError).toBe(true);
		expect(JSON.stringify(asBob)).not.toContain('groceries');
	});

	await test.step('each user’s client only sees that user’s notes', async () => {
		const bobs = await callTool(request, bobClient.access_token, 'search_notes', {
			include_trashed: true
		});
		expect(titles(bobs)).toEqual(['Bob secret diary']);
		const alices = await callTool(request, aliceClient.access_token, 'search_notes', {
			query: 'diary',
			include_trashed: true
		});
		expect(alices.structuredContent.total).toBe(0);
	});

	await test.step('the database holds neither the secret nor any note text', async () => {
		const database = await readFile('e2e/.data/test.db');
		const secret = aliceClient.access_token.split('.')[1];
		expect(database.includes(secret)).toBe(false);
		expect(database.includes(Buffer.from(secret, 'base64url'))).toBe(false);
		expect(database.includes(aliceClient.access_token.split('.')[0] + '.')).toBe(false);
		expect(database.includes('groceries')).toBe(false);
	});
});

test('the official MCP client can connect and use it', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('sdk'));
	await newNote(page, 'Note for the SDK');
	await waitSynced(page);
	const { access_token } = await connect(page, request);

	const client = new Client({ name: 'e2e', version: '1.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(MCP_URL), {
			requestInit: { headers: { Authorization: `Bearer ${access_token}` } }
		})
	);
	expect(client.getServerVersion()?.name).toBe('plakkert');
	expect(client.getInstructions()).toContain('Read only');
	const result = await client.callTool({ name: 'search_notes', arguments: { query: 'sdk' } });
	expect(JSON.stringify(result.structuredContent)).toContain('Note for the SDK');
	await client.close();
});

test('the official MCP client can sign in on its own, from the 401 onwards', async ({ app }) => {
	const { page } = await app.register(uniqueName('sdkauth'));
	await newNote(page, 'Found after signing in');
	await waitSynced(page);

	// What an MCP client keeps between steps of signing in.
	let clientInformation: OAuthClientInformationMixed | undefined;
	let tokens: OAuthTokens | undefined;
	let codeVerifier = '';
	let authorizationUrl: URL | undefined;
	const provider: OAuthClientProvider = {
		redirectUrl: REDIRECT_URI,
		clientMetadata: {
			client_name: 'SDK client',
			redirect_uris: [REDIRECT_URI],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		},
		clientInformation: () => clientInformation,
		saveClientInformation: (info) => void (clientInformation = info),
		tokens: () => tokens,
		saveTokens: (saved) => void (tokens = saved),
		redirectToAuthorization: (url) => void (authorizationUrl = url),
		saveCodeVerifier: (verifier) => void (codeVerifier = verifier),
		codeVerifier: () => codeVerifier
	};

	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });
	await expect(new Client({ name: 'e2e', version: '1' }).connect(transport)).rejects.toThrow(
		UnauthorizedError
	);
	// It found the authorize page through the metadata, and asks for this server's MCP endpoint.
	expect(authorizationUrl?.origin + authorizationUrl!.pathname).toBe(url('/oauth/authorize'));
	expect(authorizationUrl?.searchParams.get('resource')).toBe(MCP_URL);
	expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');

	const waitForRedirect = await catchRedirect(page);
	await page.goto(authorizationUrl!.href);
	await page.getByRole('button', { name: 'Turn on MCP access' }).click();
	await page.getByRole('button', { name: 'Allow' }).click();
	await transport.finishAuth((await waitForRedirect()).get('code')!);

	const client = new Client({ name: 'e2e', version: '1' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider })
	);
	const result = await client.callTool({ name: 'search_notes', arguments: {} });
	expect(JSON.stringify(result.structuredContent)).toContain('Found after signing in');
	await client.close();
});

test('the settings turn MCP access on and off, and show connected apps', async ({
	app,
	request
}) => {
	const { page } = await app.register(uniqueName('mcpsettings'));
	await page.goto(url('/settings'));
	const toggle = page.getByLabel('Let MCP clients read your notes');
	await expect(toggle).not.toBeChecked();
	await expect(page.getByText('Server address')).toHaveCount(0);
	await toggle.check();
	await expect(page.locator('code', { hasText: MCP_URL })).toBeVisible();
	await expect(page.getByText('None yet.')).toBeVisible();

	const client = await connect(page, request);
	await page.goto(url('/settings'));
	await expect(page.getByText('Test client')).toBeVisible();
	await expect(page.getByText(/Connected .* · not used yet/)).toBeVisible();
	if (process.env.SHOT_DIR) {
		await page.locator('.preferencesList', { hasText: 'MCP' }).screenshot({
			path: `${process.env.SHOT_DIR}/mcp-settings.png`
		});
	}

	await page.getByRole('button', { name: 'Disconnect' }).click();
	await expect(page.getByText('None yet.')).toBeVisible();
	const search = () =>
		rpc(request, client.access_token, 'tools/call', { name: 'search_notes', arguments: {} });
	expect((await search()).status()).toBe(401);

	// Turning it off with an app connected asks first.
	const second = await connect(page, request);
	await page.goto(url('/settings'));
	await page.getByLabel('Let MCP clients read your notes').uncheck();
	await expect(page.locator('dialog[open]')).toContainText('“Test client” will be disconnected');
	await page.locator('dialog[open]').getByRole('button', { name: 'Turn off' }).click();
	await expect(page.getByText('Server address')).toHaveCount(0);
	expect(
		(
			await rpc(request, second.access_token, 'tools/call', {
				name: 'search_notes',
				arguments: {}
			})
		).status()
	).toBe(401);
});

test('MCP requests need a valid, current token of a user who allows it', async ({
	app,
	request
}) => {
	const { page } = await app.register(uniqueName('mcp'));
	await newNote(page, 'Private thought');
	await waitSynced(page);
	const client = await connect(page, request);
	const search = (token: string | null, headers: Record<string, string> = {}) =>
		rpc(request, token, 'tools/call', { name: 'search_notes', arguments: {} }, headers);

	await test.step('without a token, it says where to sign in', async () => {
		const response = await search(null);
		expect(response.status()).toBe(401);
		expect(response.headers()['www-authenticate']).toBe(
			`Bearer resource_metadata="${url('/.well-known/oauth-protected-resource/mcp')}", scope="notes:read"`
		);
	});

	await test.step('made up, tampered or refresh tokens are refused', async () => {
		const [id, secret] = client.access_token.split('.');
		const flipped = secret.slice(0, -2) + (secret.endsWith('AA') ? 'AB' : 'AA');
		for (const token of [
			'nonsense',
			`${id}.${flipped}`,
			client.refresh_token,
			`${client.refresh_token.split('.')[0]}.${secret}`
		]) {
			const response = await search(token);
			expect(response.status(), token).toBe(401);
			expect(response.headers()['www-authenticate']).toContain('error="invalid_token"');
			expect(await response.text()).not.toContain('Private thought');
		}
	});

	await test.step('pages on other sites can’t use it', async () => {
		const response = await search(client.access_token, { Origin: 'https://evil.example.com' });
		expect(response.status()).toBe(403);
	});

	await test.step('revoking the client in the settings stops its token', async () => {
		expect((await search(client.access_token)).status()).toBe(200);
		const { clients } = await (await page.request.get(url('/api/mcp/access'))).json();
		expect(clients).toHaveLength(1);
		const revoke = await page.request.delete(url(`/api/mcp/clients/${clients[0].id}`), {
			headers: { Origin: url('/').replace(/\/$/, '') }
		});
		expect(revoke.status()).toBe(204);
		expect((await search(client.access_token)).status()).toBe(401);
	});

	await test.step('turning off MCP access stops every client, for good', async () => {
		const second = await connect(page, request);
		expect((await search(second.access_token)).status()).toBe(200);
		const origin = { Origin: url('/').replace(/\/$/, '') };
		await page.request.put(url('/api/mcp/access'), { headers: origin, data: { enabled: false } });
		expect((await search(second.access_token)).status()).toBe(401);
		// Turning it on again doesn't bring old tokens back.
		await page.request.put(url('/api/mcp/access'), { headers: origin, data: { enabled: true } });
		expect((await search(second.access_token)).status()).toBe(401);
	});
});

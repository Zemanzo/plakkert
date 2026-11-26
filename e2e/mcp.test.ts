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
import Database from 'better-sqlite3';
import {
	addTag,
	clickNoteButton,
	closeNote,
	expect,
	newNote,
	noteAction,
	openNote,
	test,
	uniqueName,
	url,
	waitSynced
} from './helpers';
import { callTool, catchRedirect, connect, MCP_URL, REDIRECT_URI, rpc, titles } from './mcpClient';

// What MCP clients can do with a user's notes, once connected (see oauth.test.ts): read them,
// only theirs, and only while the user allows it. Changing them: see mcpWrite.test.ts.

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
			'list_colors',
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
		expect(tags.structuredContent).toEqual({ tags: [{ name: 'Shopping', count: 1 }], skipped: 0 });

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

test('search results have colors and dates, can be sorted and paged, and report skipped notes', async ({
	app,
	request
}) => {
	const { page } = await app.register(uniqueName('search'));
	await newNote(page, 'Groceries for Sunday');
	await newNote(page, '🧮- Boerenkoolstamppot');
	await newNote(page, 'Plans | ideas');
	await openNote(page, 'Groceries');
	await clickNoteButton(page, 'Pick color');
	await page.locator('#colorSelection label[title=Red]').click();
	await closeNote(page);
	await addTag(page, 'Boerenkoolstamppot', 'Recepten');
	await waitSynced(page);
	// With hidden notes, so it still sees the note whose tags get damaged below.
	const { access_token } = await connect(page, request, { hidden: true });
	const withoutHidden = await connect(page, request, {}, 'Without hidden notes');
	const search = (args: Record<string, unknown>) =>
		callTool(request, access_token, 'search_notes', args);

	await test.step('summaries have the color and when notes were created', async () => {
		const result = await search({ color: 'red' });
		expect(result.structuredContent).toMatchObject({
			total: 1,
			offset: 0,
			has_more: false,
			next_offset: null,
			skipped: 0
		});
		const [groceries] = result.structuredContent.notes as Record<string, unknown>[];
		expect(groceries).toMatchObject({ title: 'Groceries for Sunday', color: 'red' });
		expect(Date.parse(groceries.created as string)).toBeGreaterThan(Date.now() - 600_000);
		const colors = await callTool(request, access_token, 'list_colors');
		expect(colors.structuredContent).toEqual({
			colors: [
				{ color: 'yellow', count: 2 },
				{ color: 'red', count: 1 }
			],
			skipped: 0
		});
	});

	await test.step('words are found next to emoji and punctuation; punctuation alone is refused', async () => {
		expect(titles(await search({ query: 'Boerenkoolstamppot' }))).toEqual([
			'🧮- Boerenkoolstamppot'
		]);
		expect(titles(await search({ query: 'stamppot recepten' }))).toEqual([
			'🧮- Boerenkoolstamppot'
		]);
		const pipe = await search({ query: '|' });
		expect(pipe.isError).toBe(true);
		expect(pipe.content[0].text).toContain('no letters or digits');
	});

	await test.step('sorted by creation, either way, and paged', async () => {
		const oldest = await search({ sort: 'created', order: 'oldest', limit: 2 });
		expect((oldest.structuredContent.notes as { title: string }[]).map((n) => n.title)).toEqual([
			'Groceries for Sunday',
			'🧮- Boerenkoolstamppot'
		]);
		expect(oldest.structuredContent).toMatchObject({ total: 3, has_more: true, next_offset: 2 });
		const rest = await search({ sort: 'created', order: 'oldest', limit: 2, offset: 2 });
		expect(titles(rest)).toEqual(['Plans | ideas']);
		expect(rest.structuredContent).toMatchObject({ has_more: false, next_offset: null });
		const future = await search({ created_after: '2100-01-01' });
		expect(future.structuredContent.total).toBe(0);
		expect((await search({ created_before: 'yesterday-ish' })).isError).toBe(true);
	});

	await test.step('the text is compact JSON of the same result', async () => {
		const result = await search({});
		expect(result.content[0].text).not.toContain('\n');
		expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
	});

	await test.step('notes that can’t be decrypted are counted, never shown', async () => {
		const all = (await search({})).structuredContent.notes as { id: string; title: string }[];
		const plans = all.find((n) => n.title === 'Plans | ideas')!;
		const recipe = all.find((n) => n.title.includes('Boerenkool'))!;
		const database = new Database('e2e/.data/test.db');
		database.pragma('busy_timeout = 5000');
		// Damaged ciphertext: the note can't be read at all.
		database
			.prepare('UPDATE notes SET content = ? WHERE id = ?')
			.run(Buffer.alloc(64, 1), plans.id);
		// Damaged tags: the note is still there, like in the app, just without its tags.
		database
			.prepare('UPDATE user_notes SET tags = ? WHERE note_id = ?')
			.run(Buffer.alloc(64, 2), recipe.id);
		database.close();

		const result = await search({});
		expect(result.structuredContent).toMatchObject({ total: 2, skipped: 1 });
		expect(titles(result)).toEqual(['Groceries for Sunday', '🧮- Boerenkoolstamppot']);
		expect((await search({ query: 'stamppot' })).structuredContent.notes).toMatchObject([
			{ tags: [] }
		]);
		const unreadable = await callTool(request, access_token, 'get_note', { id: plans.id });
		expect(unreadable.isError).toBe(true);
		expect(unreadable.content[0].text).toContain("couldn't be decrypted");
		const tags = await callTool(request, access_token, 'list_tags');
		expect(tags.structuredContent).toEqual({ tags: [], skipped: 1 });

		// Its tags might have hidden it, so an app that may not see hidden notes doesn't get it.
		const notHidden = await callTool(request, withoutHidden.access_token, 'search_notes');
		expect(titles(notHidden)).toEqual(['Groceries for Sunday']);
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
	expect(client.getInstructions()).toContain(
		'The user chose what you may do: search and read notes.'
	);
	const result = await client.callTool({ name: 'search_notes', arguments: { query: 'sdk' } });
	expect(JSON.stringify(result.structuredContent)).toContain('Note for the SDK');
	await client.close();
});

test('the official MCP client can sign in on its own, from the 401 onward', async ({ app }) => {
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
	const toggle = page.getByLabel('Let MCP clients use your notes');
	// Until the settings have loaded, the toggle is unchecked and disabled, whatever they are.
	await expect(toggle).toBeEnabled();
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
	// Otherwise unchecking it while it loads does nothing, as it's unchecked until then.
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
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
			`Bearer resource_metadata="${url('/.well-known/oauth-protected-resource/mcp')}", scope="notes"`
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

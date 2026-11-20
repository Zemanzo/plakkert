import { expect, PASSWORD, test, uniqueName, url } from './helpers';
import {
	authorize,
	authorizeUrl,
	catchRedirect,
	connect,
	exchangeCode,
	MCP_URL,
	pkcePair,
	REDIRECT_URI,
	registerClient,
	token
} from './mcpClient';

// Signing in MCP clients with OAuth, with the app as authorization server. What MCP clients can
// then do is in mcp.test.ts.

test('MCP clients can discover how to sign in', async ({ request }) => {
	const resource = await request.get(url('/.well-known/oauth-protected-resource/mcp'));
	expect(await resource.json()).toMatchObject({
		resource: MCP_URL,
		authorization_servers: [url('/').replace(/\/$/, '')],
		scopes_supported: ['notes:read']
	});
	expect(resource.headers()['cache-control']).toBe('no-store');

	const server = await (await request.get(url('/.well-known/oauth-authorization-server'))).json();
	expect(server).toMatchObject({
		issuer: url('/').replace(/\/$/, ''),
		authorization_endpoint: url('/oauth/authorize'),
		token_endpoint: url('/api/oauth/token'),
		registration_endpoint: url('/api/oauth/register'),
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		grant_types_supported: ['authorization_code', 'refresh_token']
	});
});

test('a user can connect a client, which gets tokens that rotate', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('oauth'));

	await test.step('the authorize page asks to turn on MCP access first', async () => {
		const clientId = await registerClient(request, { client_name: 'My <b>assistant</b>' });
		await page.goto(authorizeUrl(clientId, pkcePair().challenge));
		// The name is shown as text, never as markup.
		await expect(page.locator('.authorize h1')).toHaveText(
			'Let “My <b>assistant</b>” read your notes?'
		);
		await expect(page.getByText('You’ll go back to http://127.0.0.1:9')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Turn on MCP access' }).click();
		await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
	});

	const tokens = await connect(page, request);
	expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'notes:read' });

	await test.step('refresh tokens rotate, and reusing one revokes the client', async () => {
		const refresh = () =>
			token(request, {
				grant_type: 'refresh_token',
				refresh_token: tokens.refresh_token,
				client_id: tokens.clientId,
				resource: MCP_URL
			});
		const first = await refresh();
		expect(first.status()).toBe(200);
		const rotated = await first.json();
		expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

		// The old one again: it may have leaked, so the whole grant goes.
		expect((await refresh()).status()).toBe(400);
		const afterReuse = await token(request, {
			grant_type: 'refresh_token',
			refresh_token: rotated.refresh_token,
			client_id: tokens.clientId
		});
		expect(afterReuse.status()).toBe(400);
		expect(await afterReuse.json()).toMatchObject({ error: 'invalid_grant' });
	});
});

test('codes only work once, for their client, with their verifier', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('oauth'));
	const clientId = await registerClient(request);
	const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) =>
		token(request, {
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
			...extra
		});

	await test.step('a wrong verifier, client or redirect URI is refused', async () => {
		const { verifier, challenge } = pkcePair();
		const code = await authorize(page, clientId, challenge);
		expect((await exchange(code, pkcePair().verifier)).status()).toBe(400);
		// The code was used up by that attempt, also with the right verifier now.
		expect((await exchange(code, verifier)).status()).toBe(400);
	});

	await test.step('another client can’t use the code', async () => {
		const { verifier, challenge } = pkcePair();
		const code = await authorize(page, clientId, challenge);
		const otherClient = await registerClient(request);
		expect((await exchange(code, verifier, { client_id: otherClient })).status()).toBe(400);
	});

	await test.step('nor can a different redirect URI, or resource', async () => {
		const { verifier, challenge } = pkcePair();
		const code = await authorize(page, clientId, challenge);
		const response = await exchange(code, verifier, { redirect_uri: 'http://127.0.0.1:9/other' });
		expect(response.status()).toBe(400);

		const second = pkcePair();
		const code2 = await authorize(page, clientId, second.challenge);
		const wrongResource = await exchange(code2, second.verifier, {
			resource: 'https://evil.example.com/mcp'
		});
		expect(wrongResource.status()).toBe(400);
	});

	await test.step('a code that was exchanged once can’t be exchanged again', async () => {
		const { verifier, challenge } = pkcePair();
		const code = await authorize(page, clientId, challenge);
		await exchangeCode(request, clientId, code, verifier);
		const again = await exchange(code, verifier);
		expect(again.status()).toBe(400);
		expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
	});

	await test.step('a tampered code is refused', async () => {
		const { verifier, challenge } = pkcePair();
		const code = await authorize(page, clientId, challenge);
		const [id, secret] = code.split('.');
		const tampered = `${id}.${secret.slice(0, -2)}${secret.endsWith('AA') ? 'AB' : 'AA'}`;
		expect((await exchange(tampered, verifier)).status()).toBe(400);
	});
});

test('the authorize page refuses unknown clients and redirect URIs', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('oauth'));
	const waitForRedirect = await catchRedirect(page);
	let redirected = false;
	void waitForRedirect().then(() => (redirected = true));

	await page.goto(authorizeUrl('unknown-client-id-00000', pkcePair().challenge));
	await expect(page.getByText('This app isn’t registered')).toBeVisible();

	const clientId = await registerClient(request);
	await page.goto(
		authorizeUrl(clientId, pkcePair().challenge, { redirect_uri: 'https://evil.example.com/cb' })
	);
	await expect(page.getByText('didn’t register')).toBeVisible();
	expect(redirected).toBe(false);

	// Errors the client made go back to the client.
	await page.goto(authorizeUrl(clientId, pkcePair().challenge, { code_challenge_method: 'plain' }));
	const params = await waitForRedirect();
	expect(params.get('error')).toBe('invalid_request');
	expect(params.get('state')).toBe('some-state');
});

test('denying sends the client away with nothing', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('oauth'));
	const clientId = await registerClient(request);
	const waitForRedirect = await catchRedirect(page);
	await page.goto(authorizeUrl(clientId, pkcePair().challenge));
	await page.getByRole('button', { name: 'Turn on MCP access' }).click();
	await page.getByRole('button', { name: 'Deny' }).click();
	const params = await waitForRedirect();
	expect(params.get('error')).toBe('access_denied');
	expect(params.get('code')).toBeNull();
});

test('a logged out user logs in first, and comes back to the authorize page', async ({
	app,
	request
}) => {
	const username = uniqueName('oauth');
	await app.register(username);
	const clientId = await registerClient(request);
	const { page } = await app.open('another device');
	const authorizePage = authorizeUrl(clientId, pkcePair().challenge);
	await page.goto(authorizePage);
	await page.waitForURL(/\/login\?next=/);
	await page.fill('#username', username);
	await page.fill('#password', PASSWORD);
	await page.click('button[type=submit]');
	await page.waitForURL(authorizePage);
	await expect(page.getByRole('button', { name: 'Turn on MCP access' })).toBeVisible();

	// The login page only goes back to the authorize page, not anywhere else.
	await page.goto(url('/login?next=https://evil.example.com/'));
	await page.waitForURL(url('/'));
});

test('other sites can’t approve clients or change MCP access with the user’s cookies', async ({
	app,
	request
}) => {
	const { page } = await app.register(uniqueName('oauth'));
	const clientId = await registerClient(request);
	const query = new URL(authorizeUrl(clientId, pkcePair().challenge)).search.slice(1);
	const headers = { Origin: 'https://evil.example.com' };

	const approve = await page.request.post(url('/api/oauth/authorize'), {
		headers,
		data: { query, wrappedKey: 'A'.repeat(96), secretHash: 'A'.repeat(43) }
	});
	expect(approve.status()).toBe(403);
	const access = await page.request.put(url('/api/mcp/access'), {
		headers,
		data: { enabled: true }
	});
	expect(access.status()).toBe(403);
	// A form from another site is refused before it gets anywhere.
	const form = await page.request.put(url('/api/mcp/access'), {
		headers,
		form: { enabled: 'true' }
	});
	expect(form.status()).toBe(403);

	// Without the session cookie, the API doesn't know who's asking at all.
	expect((await request.get(url('/api/mcp/access'))).status()).toBe(401);
	expect((await request.post(url('/api/oauth/authorize'), { data: { query } })).status()).toBe(401);
});

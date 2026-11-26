import _sodium from 'libsodium-wrappers';
import type { APIRequestContext } from '@playwright/test';
import {
	closeNote,
	expect,
	goTo,
	newNote,
	note,
	noteAction,
	openedNote,
	openNote,
	openSharing,
	PASSWORD,
	share,
	syncNow,
	test,
	uniqueName,
	url
} from './helpers';
import { connect, MCP_URL, rpc, token } from './mcpClient';

// Security audit, 2026-11-26. Each test asserts the SAFE behavior, so it fails while the problem
// it's about is still there. Each is marked with test.fail so CI stays green meanwhile; once a
// problem is fixed its test passes, which Playwright reports as a failure, so change its
// test.fail back to test then.
//
// The attacker is an ordinary user of the same server, who talks to the API directly rather than
// through the app, with notes encrypted the way the app does.

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function sodium() {
	await _sodium.ready;
	return _sodium;
}

async function me(request: APIRequestContext) {
	const response = await request.get(url('/api/user'));
	expect(response.status()).toBe(200);
	return (await response.json()) as { id: string; publicKey: string };
}

async function lookUp(request: APIRequestContext, username: string) {
	const response = await request.get(url(`/api/users/${encodeURIComponent(username)}`));
	expect(response.status()).toBe(200);
	return (await response.json()) as { id: string; publicKey: string };
}

async function encryptJson(value: unknown, noteKey: Uint8Array) {
	const s = await sodium();
	const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
	const ciphertext = s.crypto_secretbox_easy(JSON.stringify(value), nonce, noteKey);
	const combined = new Uint8Array(nonce.length + ciphertext.length);
	combined.set(nonce);
	combined.set(ciphertext, nonce.length);
	return combined;
}

async function seal(noteKey: Uint8Array, publicKey: string) {
	const s = await sodium();
	return b64(s.crypto_box_seal(noteKey, new Uint8Array(Buffer.from(publicKey, 'base64'))));
}

/** Creates a note with any id, through the batch endpoint, as the app would encrypt it. */
async function createNote(
	request: APIRequestContext,
	id: string,
	data: { content: string; meta: { color: string } }
) {
	const s = await sodium();
	const owner = await me(request);
	const noteKey = s.crypto_secretbox_keygen();
	const now = Date.now();
	const response = await request.post(url('/api/notes/batch'), {
		data: {
			notes: [
				{
					id,
					note: {
						content: b64(await encryptJson(data, noteKey)),
						noteKey: await seal(noteKey, owner.publicKey),
						createdAt: now,
						updatedAt: now
					}
				}
			]
		}
	});
	expect(response.status()).toBe(200);
	const { results } = await response.json();
	return { status: results[0].note.status as number, noteKey };
}

async function shareWith(
	request: APIRequestContext,
	id: string,
	noteKey: Uint8Array,
	recipient: { id: string; publicKey: string },
	permissions: 'view' | 'edit'
) {
	return request.put(url(`/api/notes/${encodeURIComponent(id)}/shares/${recipient.id}`), {
		data: { noteKey: await seal(noteKey, recipient.publicKey), permissions }
	});
}

test('removing a note shared with you can’t delete one of your own notes', async ({ app }) => {
	const victimName = uniqueName('vic');
	const attackerName = uniqueName('att');
	const victim = await app.register(victimName);
	const attacker = await app.register(attackerName);

	// The victim shares a note with the attacker, who so learns its id.
	await newNote(victim.page, 'Precious notes');
	await syncNow(victim.page);
	await openSharing(victim.page, 'Precious notes');
	await share(victim.page, attackerName, 'view');
	await expect(victim.page.locator('#shareOptions')).toContainText(attackerName);
	await closeNote(victim.page);

	const changes = await (await attacker.context.request.get(url('/api/notes/changes'))).json();
	const precious = changes.notes.find(
		(n: { ownerUsername: string }) => n.ownerUsername === victimName
	);
	expect(precious).toBeDefined();
	const preciousId: string = precious.id;

	// The attacker shares a note back, whose id ends in "#": the browser cuts the URL off there.
	const decoyId = `${preciousId}#`;
	const decoy = await createNote(attacker.context.request, decoyId, {
		content: '<h1>Spam</h1><p>Please remove me</p>',
		meta: { color: 'yellow' }
	});
	expect(decoy.status).toBe(200);
	const shared = await shareWith(
		attacker.context.request,
		decoyId,
		decoy.noteKey,
		await lookUp(attacker.context.request, victimName),
		'view'
	);
	expect(shared.status()).toBe(204);

	// The victim gets rid of the spam: trash, then remove it from their notes.
	await syncNow(victim.page);
	await expect(note(victim.page, 'Please remove me')).toBeVisible();
	await noteAction(victim.page, 'Please remove me', 'Move to trash');
	await goTo(victim.page, 'Trash');
	await openNote(victim.page, 'Please remove me');
	await openedNote(victim.page).getByRole('button', { name: 'Remove from my notes' }).click();
	await victim.page.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
	await expect(note(victim.page, 'Please remove me')).toHaveCount(0);

	// Their own note must still be there.
	const stored = await (
		await victim.context.request.get(url(`/api/notes/${encodeURIComponent(preciousId)}`))
	).json();
	expect(stored.deletedAt, 'the victim’s own note was deleted').toBeNull();
	expect(stored.content).not.toBeNull();
});

test('a shared note’s color can’t inject CSS into the recipient’s app', async ({ app }) => {
	const victimName = uniqueName('vic');
	const victim = await app.register(victimName);
	const attacker = await app.register(uniqueName('att'));

	const tracked: string[] = [];
	await victim.page.route('http://tracker.invalid/**', (route) => {
		tracked.push(route.request().url());
		return route.fulfill({ status: 200, contentType: 'image/gif', body: '' });
	});

	const id = crypto.randomUUID();
	const created = await createNote(attacker.context.request, id, {
		content: '<h1>Hello</h1><p>Colorful note</p>',
		meta: {
			color:
				'yellow);background-image:url(http://tracker.invalid/seen.gif?by=victim);' +
				'position:fixed;inset:0;z-index:9999;--x:('
		}
	});
	expect(created.status).toBe(200);
	const shared = await shareWith(
		attacker.context.request,
		id,
		created.noteKey,
		await lookUp(attacker.context.request, victimName),
		'view'
	);
	expect(shared.status()).toBe(204);

	await syncNow(victim.page);
	const card = note(victim.page, 'Colorful note');
	await expect(card).toBeVisible();
	await victim.page.waitForTimeout(1000);

	const style = await card.evaluate((element) => {
		const computed = getComputedStyle(element);
		return { backgroundImage: computed.backgroundImage, position: computed.position };
	});
	expect(tracked, 'the recipient’s browser loaded a URL the sharer chose').toEqual([]);
	expect(style.backgroundImage).toBe('none');
	expect(style.position).not.toBe('fixed');
});

test.fail(
	'someone a note is shared with to edit can’t wipe its owner’s history',
	async ({ app }) => {
		const ownerName = uniqueName('own');
		const editorName = uniqueName('edt');
		const owner = await app.register(ownerName);
		const editor = await app.register(editorName);
		const ownerRequest = owner.context.request;

		const history = await ownerRequest.put(url('/api/user/history'), { data: { enabled: true } });
		const { since } = await history.json();
		expect(since).not.toBeNull();

		// The owner's note, with three versions from the past days, as their devices would send them.
		const id = crypto.randomUUID();
		const created = await createNote(ownerRequest, id, {
			content: '<h1>Plans</h1><p>Today</p>',
			meta: { color: 'yellow' }
		});
		expect(created.status).toBe(200);
		const day = 24 * 60 * 60 * 1000;
		const realVersions = [2, 5, 10].map((days) => Date.now() - days * day);
		for (const updatedAt of realVersions) {
			const content = b64(
				await encryptJson({ content: `<p>${days(updatedAt)}</p>`, meta: {} }, created.noteKey)
			);
			const response = await ownerRequest.post(url('/api/notes/batch'), {
				data: { notes: [{ id, versions: [{ content, updatedAt, since }] }] }
			});
			expect((await response.json()).results[0].versions[0].status).toBe(200);
		}
		function days(at: number) {
			return Math.round((Date.now() - at) / day);
		}

		const shared = await shareWith(
			ownerRequest,
			id,
			created.noteKey,
			await lookUp(ownerRequest, editorName),
			'edit'
		);
		expect(shared.status()).toBe(204);

		// The editor stores big versions of their own, newer than the owner's, until the history is full.
		// Exactly MAX_HISTORY_BYTES in all, so no other version fits anymore, however small.
		const sizes = [...Array(14).fill(360_000), 5 * 1024 * 1024 - 14 * 360_000];
		for (const [i, size] of sizes.entries()) {
			const junk = b64(new Uint8Array(size));
			const response = await editor.context.request.post(url('/api/notes/batch'), {
				data: {
					notes: [{ id, versions: [{ content: junk, updatedAt: Date.now() - i * 1000, since }] }]
				}
			});
			expect((await response.json()).results[0].versions[0].status).toBe(200);
		}

		const { versions } = await (await ownerRequest.get(url(`/api/notes/${id}/versions`))).json();
		const kept = versions.map((v: { updatedAt: number }) => v.updatedAt);
		for (const updatedAt of realVersions) {
			expect(kept, `the owner’s version from ${days(updatedAt)} days ago is gone`).toContain(
				updatedAt
			);
		}
	}
);

test.fail('logging in on a new device never sends the password itself', async ({ app }) => {
	const name = uniqueName('pwd');
	await app.register(name);

	// A new device, and a server (or anyone in between) that answers the auth key with a 401.
	const device = await app.open(`${name} (new device)`);
	const sent: string[] = [];
	await device.page.route('**/api/auth/sign-in/username', async (route) => {
		const body = route.request().postData() ?? '';
		sent.push(body);
		if (sent.length === 1) {
			return route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Invalid username or password' })
			});
		}
		return route.continue();
	});
	await device.page.goto(url('/login'));
	await device.page.fill('#username', name);
	await device.page.fill('#password', PASSWORD);
	await device.page.click('button[type=submit]');
	await device.page.waitForTimeout(5000);

	expect(sent.length).toBeGreaterThan(0);
	for (const body of sent) {
		expect(body, 'the password itself was sent to the server').not.toContain(PASSWORD);
	}
});

test.fail('changing the password also cuts off connected MCP apps', async ({ app, request }) => {
	const name = uniqueName('mcpw');
	const { page } = await app.register(name);
	await newNote(page, 'Secret plans');
	await syncNow(page);
	const client = await connect(page, request);

	// Say the password leaked, and whoever has it connected an app. The user changes the password.
	await page.goto(url('/settings'));
	await page.getByRole('button', { name: 'Change', exact: true }).click();
	await page.getByLabel('Current password').fill(PASSWORD);
	await page.getByLabel('New password', { exact: true }).fill('a brand new password, really');
	await page.getByLabel('Repeat the new password').fill('a brand new password, really');
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByText('Your password was changed.')).toBeVisible();

	const search = await rpc(request, client.access_token, 'tools/call', {
		name: 'search_notes',
		arguments: {}
	});
	expect(search.status(), 'the app could still read the notes').toBe(401);
	const refreshed = await token(request, {
		grant_type: 'refresh_token',
		refresh_token: client.refresh_token,
		client_id: client.clientId,
		resource: MCP_URL
	});
	expect(refreshed.status(), 'the app could still refresh its token').toBe(400);
});

test.fail('note ids have a sensible length', async ({ app }) => {
	const user = await app.register(uniqueName('ids'));
	const { status } = await createNote(user.context.request, 'x'.repeat(300_000), {
		content: '<p>Long id</p>',
		meta: { color: 'yellow' }
	});
	expect(status, 'a note with a 300,000 character id was stored').toBe(400);
});

test.fail(
	'pages are served with a Content Security Policy and can’t be framed',
	async ({ request }) => {
		for (const path of ['/', '/login', '/oauth/authorize']) {
			const response = await request.get(url(path));
			expect(response.status()).toBe(200);
			const headers = response.headers();
			const body = await response.text();
			const hasCsp =
				'content-security-policy' in headers || /http-equiv="content-security-policy"/i.test(body);
			expect(hasCsp, `${path} has no Content-Security-Policy`).toBe(true);
			const frameable =
				!('x-frame-options' in headers) &&
				!/frame-ancestors/.test(headers['content-security-policy'] ?? '');
			expect(frameable, `${path} can be framed by any site`).toBe(false);
		}
	}
);

import { generateKeyPairSync, webcrypto } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
	expect,
	INVITE_CODE,
	logIn,
	newNote,
	PASSWORD,
	syncStatus,
	test,
	uniqueName,
	url,
	waitSynced
} from './helpers';

const NEW_PASSWORD = 'a new and even better password';

/** Fills in and submits the change password form in the settings, which must be open. */
async function submitPasswordChange(page: Page, current: string, next: string, repeated = next) {
	await page.getByLabel('Current password').fill(current);
	await page.getByLabel('New password', { exact: true }).fill(next);
	await page.getByLabel('Repeat the new password').fill(repeated);
	await page.getByRole('button', { name: 'Change password' }).click();
}

async function signOut(page: Page) {
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.waitForURL(url('/login'));
}

test('changing the password keeps the notes, and logs out other devices', async ({ app }) => {
	const username = uniqueName('password');
	const a = await app.register(username);
	await newNote(a.page, 'Written before the new password');
	await waitSynced(a.page);
	const b = await app.login(username);
	await expect(b.page.getByText('Written before the new password')).toBeVisible();

	await test.step('the current password has to be right, and the new one typed twice', async () => {
		await a.page.goto(url('/settings'));
		await a.page.getByRole('button', { name: 'Change', exact: true }).click();

		await submitPasswordChange(a.page, 'not my password', NEW_PASSWORD);
		await expect(a.page.getByText('The current password is wrong.')).toBeVisible();

		await submitPasswordChange(a.page, PASSWORD, NEW_PASSWORD, 'a typo');
		await expect(a.page.getByText('The new passwords don’t match.')).toBeVisible();
	});

	await test.step('then it changes, and this device stays logged in', async () => {
		await submitPasswordChange(a.page, PASSWORD, NEW_PASSWORD);
		await expect(a.page.getByText('Your password was changed.')).toBeVisible();

		await a.page.goto(url('/'));
		await newNote(a.page, 'Written after the new password');
		await waitSynced(a.page);
	});

	await test.step('the other device has to log in again', async () => {
		await syncStatus(b.page).click();
		await expect(syncStatus(b.page)).toHaveText(/log in again/);
	});

	await test.step('the old password no longer works, the new one does', async () => {
		await signOut(a.page);
		await a.page.fill('#password', PASSWORD);
		await a.page.click('button[type=submit]');
		await expect(a.page.getByText(/invalid/i)).toBeVisible();

		await logIn(a.page, username, NEW_PASSWORD);
		await expect(a.page.getByText('Written before the new password')).toBeVisible();
		await expect(a.page.getByText('Written after the new password')).toBeVisible();
	});

	await test.step('also on the other device, which still had the old one', async () => {
		await signOut(b.page);
		await logIn(b.page, username, NEW_PASSWORD);
		await expect(b.page.getByText('Written after the new password')).toBeVisible();
		await waitSynced(b.page);
	});
});

/** Sends a request from the app's page, as the app would, with its cookies. */
function fetchFromPage(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
	return page.evaluate(
		async ({ path, method, body }) => {
			const response = await fetch(path, {
				method,
				headers: body === undefined ? {} : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return { status: response.status, body: await response.json().catch(() => null) };
		},
		{ path, method: init.method ?? 'GET', body: init.body }
	);
}

test('a session alone can’t change the keys or the username', async ({ app }) => {
	const username = uniqueName('keys');
	const { page } = await app.register(username);
	await newNote(page, 'Still readable after the attempt');
	await waitSynced(page);
	const before = (await fetchFromPage(page, '/api/user')).body;

	for (const change of [
		{ privateKey: 'AAAA', salt: 'AAAA', nonce: 'AAAA', kdfIterations: 100_000 },
		{ publicKey: 'AAAA' },
		{ username: uniqueName('renamed') }
	]) {
		const response = await fetchFromPage(page, '/api/auth/update-user', {
			method: 'POST',
			body: change
		});
		expect(response.status).toBe(403);
		expect(response.body.code).toBe('UPDATE_USER_DISABLED');
	}

	expect((await fetchFromPage(page, '/api/user')).body).toEqual(before);
	await signOut(page);
	await logIn(page, username);
	await expect(page.getByText('Still readable after the attempt')).toBeVisible();
});

const LEGACY_KDF_ITERATIONS = 100_000;
const KDF_ITERATIONS = 600_000;

const base64 = (bytes: Uint8Array | ArrayBuffer) =>
	Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64');

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
	const key = await webcrypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	return webcrypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
		key,
		256
	);
}

/**
 * The sign-up of an account from before the private key was encrypted with stronger settings, as
 * the app does it (see src/lib/client/cryptography/PrivateKey.ts), but with fewer iterations.
 */
async function legacySignUp(username: string, password: string) {
	// What libsodium's crypto_box_keypair makes: raw X25519 keys.
	const jwk = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' });
	const privateKey = Buffer.from(jwk.d!, 'base64url');
	const publicKey = Buffer.from(jwk.x!, 'base64url');

	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const nonce = webcrypto.getRandomValues(new Uint8Array(12));
	const aesKey = await webcrypto.subtle.importKey(
		'raw',
		await pbkdf2(password, salt, LEGACY_KDF_ITERATIONS),
		'AES-GCM',
		false,
		['encrypt']
	);
	const encryptedKey = await webcrypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		aesKey,
		privateKey
	);
	const authKey = await pbkdf2(
		password,
		new TextEncoder().encode('plakkert-auth:' + username),
		KDF_ITERATIONS
	);

	return {
		email: webcrypto.randomUUID() + '@example.com',
		name: '',
		username,
		password: base64(authKey),
		publicKey: base64(publicKey),
		privateKey: base64(encryptedKey),
		salt: base64(salt),
		nonce: base64(nonce),
		kdfIterations: LEGACY_KDF_ITERATIONS,
		rememberMe: true
	};
}

test('an older account’s key is encrypted again at login, without logging out other devices', async ({
	app
}) => {
	const username = uniqueName('legacy');
	const first = await app.open('first device');
	await first.page.goto(url('/login'));
	const body = await legacySignUp(username, PASSWORD);
	const signUpStatus = await first.page.evaluate(
		async ({ body, inviteCode }) => {
			const response = await fetch('/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-invite-code': inviteCode },
				body: JSON.stringify(body)
			});
			return response.status;
		},
		{ body, inviteCode: INVITE_CODE }
	);
	expect(signUpStatus).toBe(200);

	const { page } = await app.login(username);
	await expect
		.poll(async () => (await fetchFromPage(page, '/api/user')).body.kdfIterations)
		.toBe(KDF_ITERATIONS);
	// The first device's session, from signing up, is still there.
	expect((await fetchFromPage(first.page, '/api/user')).status).toBe(200);

	await newNote(page, 'Written with the upgraded key');
	await waitSynced(page);
	await signOut(page);
	await logIn(page, username);
	await expect(page.getByText('Written with the upgraded key')).toBeVisible();
});

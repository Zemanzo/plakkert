import { expect, INVITE_CODE, signUp, test, uniqueName, url } from './helpers';

// The test server only lets people with the invite code register.

test('registering needs the invite code', async ({ app }) => {
	const { page } = await app.open('visitor');
	await page.goto(url('/register'));

	await test.step('a wrong invite code is rejected', async () => {
		await signUp(page, uniqueName('nope'), 'not the code');
		await expect(page.getByText('That invite code isn’t valid.')).toBeVisible();
		await expect(page).toHaveURL(url('/register'));
	});

	await test.step('the sign-up endpoint itself also checks it', async () => {
		const response = await page.evaluate(async () => {
			const response = await fetch('/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					email: `${crypto.randomUUID()}@example.com`,
					name: '',
					username: `direct${Date.now()}`,
					password: 'a password that is long enough',
					publicKey: 'x',
					privateKey: 'x',
					salt: 'x',
					nonce: 'x'
				})
			});
			return { status: response.status, body: await response.json() };
		});
		expect(response.status).toBe(403);
		expect(response.body.code).toBe('INVALID_INVITE_CODE');
	});

	await test.step('the right invite code works', async () => {
		await signUp(page, uniqueName('invited'));
		await page.waitForURL(url('/'));
	});
});

test('an invite link fills in the code', async ({ app }) => {
	const { page } = await app.open('invited');
	await page.goto(url(`/register?invite=${encodeURIComponent(INVITE_CODE)}`));
	await expect(page.locator('#inviteCode')).toHaveValue(INVITE_CODE);

	await page.fill('#username', uniqueName('linked'));
	await page.fill('#password', 'correct horse battery staple');
	await page.click('button[type=submit]');
	await page.waitForURL(url('/'));
});

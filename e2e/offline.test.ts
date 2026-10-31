import { expect, logIn, newNote, PASSWORD, test, uniqueName, url } from './helpers';

test('the app works offline, including unlocking it again', async ({ app }) => {
	const username = uniqueName('Offline');
	const { context, page } = await app.register(username);
	await newNote(page, 'Written while online');
	await page.evaluate(() => navigator.serviceWorker.ready);

	await test.step('reloading offline shows the notes', async () => {
		await context.setOffline(true);
		await page.reload();
		await expect(page.getByText('Written while online')).toBeVisible();
	});

	await test.step('navigating works offline', async () => {
		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByText('Preferences')).toBeVisible();
		await page.getByRole('link', { name: 'Notes' }).first().click();
		await expect(page.getByText('Written while online')).toBeVisible();
		await page.goto(url('/settings'));
		await expect(page.getByText('Preferences')).toBeVisible();
		await page.goto(url('/trash'));
		await expect(page.getByText('The trash is empty.')).toBeVisible();
	});

	await test.step('signing out and unlocking again works offline', async () => {
		await page.getByRole('button', { name: 'Sign out' }).click();
		await page.waitForURL(url('/login'));

		await page.fill('#password', 'wrong password');
		await page.click('button[type=submit]');
		await expect(page.getByText('Invalid username or password')).toBeVisible();

		// The last username is remembered.
		await expect(page.locator('#username')).toHaveValue(username.toLowerCase());
		await logIn(page, username, PASSWORD);
		await expect(page.getByText('Written while online')).toBeVisible();
	});

	await test.step('it keeps working once back online', async () => {
		await context.setOffline(false);
		await page.reload();
		await expect(page.getByText('Written while online')).toBeVisible();
	});
});

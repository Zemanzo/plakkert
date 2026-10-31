import { expect, logIn, newNote, PASSWORD, test, uniqueName, url } from './helpers';

test('notes survive reloading and logging in again', async ({ app }) => {
	const username = uniqueName('account');
	const { page } = await app.register(username);

	await newNote(page, 'Hello from the account test');

	await test.step('the note is still there after reloading', async () => {
		await page.reload();
		await expect(page.getByText('Hello from the account test')).toBeVisible();
	});

	await test.step('and after signing out and in again', async () => {
		await page.getByRole('button', { name: 'Sign out' }).click();
		await page.waitForURL(url('/login'));
		await logIn(page, username);
		await expect(page.getByText('Hello from the account test')).toBeVisible();
	});
});

test('logging in again works with a mixed-case username', async ({ app }) => {
	const username = uniqueName('Mixed');
	const { page } = await app.register(username);
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.waitForURL(url('/login'));
	await logIn(page, username.toUpperCase(), PASSWORD);
});

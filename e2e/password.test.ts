import type { Page } from '@playwright/test';
import {
	expect,
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

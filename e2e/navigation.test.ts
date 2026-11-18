import type { BrowserContext, Page } from '@playwright/test';
import { closeNote, expect, logIn, newNote, openNote, test, uniqueName, url } from './helpers';

/** Opens the app in a new tab at a page, logging in if needed, as on a phone after a while. */
async function launch(context: BrowserContext, username: string, path: string) {
	const tab = await context.newPage();
	await tab.goto(url(path));
	const notesLink = tab.getByRole('link', { name: 'Notes' }).first();
	const password = tab.locator('#password');
	await expect(notesLink.or(password)).toBeVisible();
	if (await password.isVisible()) {
		await logIn(tab, username);
		await expect(notesLink).toBeVisible();
	}
	return tab;
}

/** Where the history goes when going back, until it leaves the app. */
async function backTrail(page: Page) {
	const trail: string[] = [];
	for (let i = 0; i < 5; i++) {
		await page.goBack();
		await page.waitForTimeout(300);
		if (page.url() === 'about:blank') break;
		const here = new URL(page.url());
		trail.push(here.pathname + here.search);
	}
	return trail;
}

test('going back shows all notes, and then leaves the app', async ({ app }) => {
	const username = uniqueName('back');
	const { context, page } = await app.register(username);
	await newNote(page, 'A note');
	const tab = await launch(context, username, '/');

	await tab.getByRole('link', { name: 'Settings' }).click();
	await expect(tab).toHaveURL(url('/settings'));
	await tab.getByRole('link', { name: 'Notes' }).first().click();
	await openNote(tab, 'A note');
	await closeNote(tab);
	await tab.getByRole('link', { name: 'Archive' }).click();
	await expect(tab).toHaveURL(url('/archive'));
	await tab.getByRole('link', { name: 'Trash' }).click();
	await expect(tab).toHaveURL(url('/trash'));

	expect(await backTrail(tab)).toEqual(['/']);
});

test('going back from an open note closes it', async ({ app }) => {
	const { page } = await app.register(uniqueName('backnote'));
	await newNote(page, 'A note');
	await page.getByRole('link', { name: 'Archive' }).click();
	await page.getByRole('link', { name: 'Notes' }).first().click();
	await openNote(page, 'A note');

	await page.goBack();
	await expect(page.locator('.isFocused')).toHaveCount(0);
	await expect(page).toHaveURL(url('/'));
});

test('a section the app was opened at is replaced by all notes', async ({ app }) => {
	const username = uniqueName('backdirect');
	const { context } = await app.register(username);
	const tab = await launch(context, username, '/settings');
	await tab.getByRole('link', { name: 'Notes' }).first().click();
	await expect(tab).toHaveURL(url('/'));

	expect(await backTrail(tab)).toEqual([]);
});

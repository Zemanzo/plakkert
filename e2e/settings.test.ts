import type { BrowserContext, Page } from '@playwright/test';
import {
	DAY_MS,
	expect,
	logIn,
	newNote,
	openNote,
	openedNote,
	test,
	uniqueName,
	url
} from './helpers';

/** Changes a setting, by its label, and saves it. */
async function changeSetting(page: Page, label: string, checked: boolean) {
	await page.goto(url('/settings'));
	await page.getByLabel(label).setChecked(checked);
	await page.getByRole('button', { name: 'Save Changes' }).click();
	await expect(page.getByText('All changes saved.')).toBeVisible();
}

/** Opens the app in a new tab, as if it was opened again after closing it. */
async function reopen(context: BrowserContext) {
	const tab = await context.newPage();
	await tab.goto(url('/'));
	await expect(
		tab.getByRole('button', { name: /new note/i }).or(tab.locator('#password'))
	).toBeVisible();
	return tab;
}

const remembered = (page: Page) =>
	page.evaluate(() => {
		const stored = localStorage.getItem('plakkert_rememberedSession');
		return stored ? (JSON.parse(stored) as { expiresAt: number }) : null;
	});

test('"Stay logged in" keeps the notes unlocked after closing the app', async ({ app }) => {
	const username = uniqueName('stay');
	const { context, page } = await app.register(username);
	await newNote(page, 'Still here');

	await test.step('by default, the app is locked again once closed', async () => {
		const tab = await reopen(context);
		await expect(tab).toHaveURL(url('/login'));
		await tab.close();
	});

	await test.step('with the setting, it stays unlocked', async () => {
		await changeSetting(page, 'Stay logged in', true);
		const tab = await reopen(context);
		await expect(tab).toHaveURL(url('/'));
		await expect(tab.getByText('Still here')).toBeVisible();
		await tab.close();
	});

	await test.step('using the app makes it last longer', async () => {
		await page.evaluate(() => {
			const key = 'plakkert_rememberedSession';
			const session = JSON.parse(localStorage.getItem(key)!);
			localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: Date.now() + 60_000 }));
		});
		const tab = await reopen(context);
		await expect(tab).toHaveURL(url('/'));
		expect((await remembered(tab))!.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY_MS);
		await tab.close();
	});

	await test.step('until it expires', async () => {
		await page.evaluate(() => {
			const key = 'plakkert_rememberedSession';
			const session = JSON.parse(localStorage.getItem(key)!);
			localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: Date.now() - 1 }));
		});
		const tab = await reopen(context);
		await expect(tab).toHaveURL(url('/login'));
		expect(await remembered(tab)).toBeNull();
		await tab.close();
	});

	await test.step('signing out forgets it', async () => {
		await page.goto(url('/'));
		expect(await remembered(page)).not.toBeNull();
		await page.getByRole('button', { name: 'Sign out' }).click();
		await page.waitForURL(url('/login'));
		expect(await remembered(page)).toBeNull();
	});

	await test.step('turning the setting off forgets it too', async () => {
		await logIn(page, username);
		await expect.poll(() => remembered(page)).not.toBeNull();
		await changeSetting(page, 'Stay logged in', false);
		await expect.poll(() => remembered(page)).toBeNull();
		// This tab stays unlocked until it's closed.
		await page.goto(url('/'));
		await expect(page.getByText('Still here')).toBeVisible();
		const tab = await reopen(context);
		await expect(tab).toHaveURL(url('/login'));
	});
});

test('on a narrow screen, notes can be shown two side by side', async ({ app }) => {
	const { page } = await app.register(uniqueName('columns'), {
		viewport: { width: 390, height: 760 }
	});
	await newNote(page, 'Left');
	await newNote(page, 'Right');
	const notes = page.locator('[data-note-id]');
	const boxes = async () => {
		const [first, second] = await Promise.all(
			[notes.nth(0), notes.nth(1)].map((n) => n.boundingBox())
		);
		return { first: first!, second: second! };
	};

	await test.step('by default, they are below each other', async () => {
		const { first, second } = await boxes();
		expect(second.y).toBeGreaterThan(first.y + first.height - 1);
	});

	await test.step('with the setting, next to each other', async () => {
		await changeSetting(page, 'Two notes side by side', true);
		await page.goto(url('/'));
		const { first, second } = await boxes();
		expect(Math.round(second.y)).toBe(Math.round(first.y));
		expect(second.x).toBeGreaterThan(first.x + first.width - 1);
		expect(second.x + second.width).toBeLessThanOrEqual(390);
	});

	await test.step('an open note still fills the screen', async () => {
		await openNote(page, 'Left');
		await expect
			.poll(async () => {
				const box = await openedNote(page).boundingBox();
				return box && [box.x, box.y, box.width, box.height].map(Math.round);
			})
			.toEqual([0, 0, 390, 760]);
	});
});

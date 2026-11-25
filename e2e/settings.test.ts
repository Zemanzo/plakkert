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
		// Using the app remembers it again, once the user has loaded.
		await page.goto(url('/'));
		await expect.poll(() => remembered(page)).not.toBeNull();
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

test('the save button shows up without moving the settings', async ({ app }) => {
	const username = uniqueName('saving');
	const { page } = await app.register(username);

	for (const size of [
		{ width: 600, height: 700 },
		{ width: 1920, height: 900 }
	]) {
		await page.setViewportSize(size);
		await page.goto(url('/settings'));
		await expect(page.getByText(`Logged in as ${username.toLowerCase()}`)).toBeVisible();
		const heading = page.getByRole('heading', { name: 'Preferences', exact: true });
		const before = await heading.boundingBox();

		await page.getByLabel('Theme').selectOption('dark');
		await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
		expect(await heading.boundingBox(), `at ${size.width}×${size.height}`).toEqual(before);

		await page.getByRole('button', { name: 'Save Changes' }).click();
		await expect(page.getByText('All changes saved.')).toBeVisible();
		expect(await heading.boundingBox()).toEqual(before);
		await page.getByLabel('Theme').selectOption('system');
		await page.getByRole('button', { name: 'Save Changes' }).click();
	}
});

test('the settings go on in another column, rather than scroll, where there’s room', async ({
	app
}) => {
	const { page } = await app.register(uniqueName('columns'));
	const section = (name: string) =>
		page.locator('.preferencesList', { has: page.getByRole('heading', { name, exact: true }) });
	const left = async (name: string) => Math.round((await section(name).boundingBox())!.x);
	const shot = async (name: string) => {
		if (process.env.SHOT_DIR) {
			await page.screenshot({ path: `${process.env.SHOT_DIR}/settings-${name}.png` });
		}
	};

	await test.step('wide and low: as many columns as needed, and MCP in one of its own', async () => {
		await page.setViewportSize({ width: 1920, height: 900 });
		await page.goto(url('/settings'));
		await expect(section('MCP')).toBeVisible();
		await shot('wide');
		const columns = new Set([
			await left('Preferences'),
			await left('Security'),
			await left('Import'),
			await left('Backup')
		]);
		expect(columns.size).toBeGreaterThan(1);
		expect(await left('MCP')).toBeGreaterThan(Math.max(...columns));
		const scroller = page.locator('main section');
		expect(
			await scroller.evaluate((el) => el.scrollHeight <= el.clientHeight),
			'the page doesn’t scroll'
		).toBe(true);
	});

	await test.step('wide and tall: one column, as everything fits in it', async () => {
		await page.setViewportSize({ width: 1920, height: 4000 });
		await expect.poll(() => left('Backup')).toBe(await left('Preferences'));
		expect(await left('MCP')).toBeGreaterThan(await left('Preferences'));
	});

	await test.step('narrow: one column, with MCP at the bottom', async () => {
		await page.setViewportSize({ width: 600, height: 900 });
		await expect.poll(() => left('MCP')).toBe(await left('Preferences'));
		await shot('narrow');
		const top = async (name: string) => (await section(name).boundingBox())!.y;
		expect(await top('MCP')).toBeGreaterThan(await top('Backup'));
	});
});

test('the settings link to the source code, and the licenses of the packages in the app', async ({
	app
}) => {
	const { context, page } = await app.register(uniqueName('licenses'));
	await page.goto(url('/settings'));
	await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
		'href',
		'https://github.com/Zemanzo/plakkert'
	);

	// Once the service worker serves the app, which serves pages from its cache.
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	const [tab] = await Promise.all([
		context.waitForEvent('page'),
		page.getByRole('link', { name: 'Open-source licenses' }).click()
	]);
	await tab.waitForLoadState();
	expect(new URL(tab.url()).pathname).toBe('/licenses.txt');
	const text = (await tab.locator('body').textContent()) ?? '';
	expect(text).toContain('This app includes the following open-source packages');
	expect(text).toContain('svelte ');
	// With its NOTICE file, which Apache-2.0 asks for.
	expect(text).toMatch(/dexie [\d.]+ \(Apache-2\.0\)/);
	expect(text).toContain('Copyright (c) 2014-2017 David Fahlander');
});

import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, syncNow, test, uniqueName, url, waitSynced } from './helpers';

// Measures how the app copes with many notes. Not a pass/fail test, so it only runs when asked:
// E2E_PERF=1 pnpm test:e2e perf
test.skip(!process.env.E2E_PERF, 'Only runs with E2E_PERF=1');

const NOTE_COUNT = 1000;

function takeout() {
	const files: Record<string, Uint8Array> = {};
	for (let i = 0; i < NOTE_COUNT; i++) {
		files[`Takeout/Keep/Note ${i}.json`] = strToU8(
			JSON.stringify({
				color: i % 3 ? 'DEFAULT' : 'RED',
				isTrashed: false,
				isPinned: false,
				isArchived: i % 10 === 0,
				title: `Perf note ${i}`,
				textContent: `Some text for note ${i}.\n`.repeat(5),
				listContent:
					i % 4 === 0
						? [
								{ text: 'One', isChecked: true },
								{ text: 'Two', isChecked: false }
							]
						: undefined,
				labels: [{ name: `Label ${i % 5}` }],
				createdTimestampUsec: (Date.UTC(2020, 0, 1) + i * 60_000) * 1000,
				userEditedTimestampUsec: (Date.UTC(2020, 0, 1) + i * 60_000) * 1000
			})
		);
	}
	return zipSync(files);
}

/** Counts the requests to the notes API, and how many bytes came back, while running `action`. */
async function countRequests(page: Page, action: () => Promise<void>) {
	let requests = 0;
	let bytes = 0;
	const onResponse = async (response: import('@playwright/test').Response) => {
		if (!new URL(response.url()).pathname.startsWith('/api/notes')) return;
		requests++;
		bytes += (await response.body().catch(() => Buffer.alloc(0))).length;
	};
	page.on('response', onResponse);
	await action();
	page.off('response', onResponse);
	return { requests, kB: Math.round(bytes / 1024) };
}

/** Total time spent in tasks over 50 ms, while running `action`. */
async function longTasks(page: Page, action: () => Promise<void>) {
	await page.evaluate(() => {
		const w = window as unknown as { __longTasks: number; __observer: PerformanceObserver };
		w.__longTasks = 0;
		w.__observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) w.__longTasks += entry.duration;
		});
		w.__observer.observe({ type: 'longtask' });
	});
	await action();
	return page.evaluate(() => {
		const w = window as unknown as { __longTasks: number; __observer: PerformanceObserver };
		w.__observer.disconnect();
		return Math.round(w.__longTasks);
	});
}

/** The page's JS heap after garbage collection, and how many DOM nodes and listeners it has. */
async function memory(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('HeapProfiler.collectGarbage');
	await cdp.send('Performance.enable');
	const { metrics } = await cdp.send('Performance.getMetrics');
	await cdp.detach();
	const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
	return {
		heapMB: Math.round(metric('JSHeapUsedSize') / 1024 / 102.4) / 10,
		domNodes: metric('Nodes'),
		listeners: metric('JSEventListeners')
	};
}

test('many notes', async ({ app }) => {
	test.setTimeout(1_800_000);
	const results = new Proxy({} as Record<string, unknown>, {
		set(target, key: string, value) {
			console.log(`${key}: ${JSON.stringify(value)}`);
			target[key] = value;
			return true;
		}
	});
	const username = uniqueName('perf');
	const { page } = await app.register(username);
	await waitSynced(page);
	results['memory without notes'] = await memory(page);

	await page.goto(url('/settings'));
	await page.locator('#import-keep').setInputFiles({
		name: 'takeout.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(takeout())
	});
	await page.getByRole('button', { name: `Import ${NOTE_COUNT} notes` }).click();
	await expect(page.locator('.importStatus')).toContainText(`Imported ${NOTE_COUNT} notes`, {
		timeout: 120_000
	});

	let start = Date.now();
	await page.goto(url('/'));
	await page.locator('[data-note-id]').first().waitFor({ timeout: 120_000 });
	results['first open after import (ms)'] = Date.now() - start;

	start = Date.now();
	results['first sync after import'] = await countRequests(page, async () => {
		await expect(page.locator('button.syncStatus')).toHaveText(/^\s*Synced\s*$/, {
			timeout: 300_000
		});
	});
	results['first sync after import (ms)'] = Date.now() - start;

	results['sync without changes'] = await countRequests(page, () => syncNow(page));

	start = Date.now();
	await page.reload();
	await page.locator('[data-note-id]').first().waitFor({ timeout: 120_000 });
	results['reload until first note (ms)'] = Date.now() - start;
	results['notes rendered'] = await page.locator('[data-note-id]').count();
	results['editors rendered'] = await page.locator('.ProseMirror[contenteditable]').count();
	await waitSynced(page);
	results['memory with notes'] = await memory(page);

	start = Date.now();
	results['long tasks while searching, with one page shown (ms)'] = await longTasks(
		page,
		async () => {
			await page.getByRole('searchbox').fill('note 999');
			await expect(page.locator('[data-note-id]', { hasText: 'Perf note 999' })).toBeVisible();
		}
	);
	results['search, with one page shown (ms)'] = Date.now() - start;
	await page.getByRole('searchbox').fill('');
	await expect(page.locator('[data-note-id]')).toHaveCount(50);

	// Scroll to the end, so every page of notes is shown, then back.
	let shown = 0;
	while (shown < (await page.locator('[data-note-id]').count())) {
		shown = await page.locator('[data-note-id]').count();
		await page.locator('.scroll-container').evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await page.waitForTimeout(500);
	}
	results['notes rendered after scrolling'] = await page.locator('[data-note-id]').count();
	results['memory after scrolling to the end'] = await memory(page);
	await page.locator('.scroll-container').evaluate((element) => (element.scrollTop = 0));

	const first = page.locator('[data-note-id]').first();
	await first.click();
	await page.locator('.isFocused .ProseMirror[contenteditable=true]').waitFor();
	await page.waitForTimeout(500);
	await page.locator('.isFocused .ProseMirror').click();
	await page.keyboard.press('Control+End');
	start = Date.now();
	results['long tasks while typing 40 characters (ms)'] = await longTasks(page, async () => {
		await page.keyboard.type('The quick brown fox jumps over the dog. ', { delay: 30 });
		await page.waitForTimeout(1500);
	});
	results['typing 40 characters (ms)'] = Date.now() - start;
	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);
	results['sync after typing'] = await countRequests(page, () => syncNow(page));

	start = Date.now();
	results['long tasks while searching, with all notes shown (ms)'] = await longTasks(
		page,
		async () => {
			await page.getByRole('searchbox').fill('note 999');
			await expect(page.locator('[data-note-id]', { hasText: 'Perf note 999' })).toBeVisible();
		}
	);
	results['search, with all notes shown (ms)'] = Date.now() - start;
	// Escape also leaves the search field, where Ctrl+A would select its text instead.
	await page.getByRole('searchbox').press('Escape');
	await expect(page.locator('[data-note-id]')).toHaveCount(50);
	const selectionBar = page.locator('.selectionBar');
	start = Date.now();
	results['long tasks while selecting all (ms)'] = await longTasks(page, async () => {
		await page.keyboard.press('ControlOrMeta+A');
		await expect(selectionBar).toContainText('selected');
	});
	results['selecting all (ms)'] = Date.now() - start;
	results['selected'] = await selectionBar.locator('.count').textContent();

	start = Date.now();
	results['long tasks while colouring all (ms)'] = await longTasks(page, async () => {
		await selectionBar.getByRole('button', { name: 'Pick color' }).click();
		await page.locator('#selectionColors label[title=Purple]').click();
		await expect(page.locator('[data-note-id]').first()).toHaveAttribute('style', /--color-purple/);
		await expect(page.locator('[data-note-id]').last()).toHaveAttribute('style', /--color-purple/);
	});
	results['colouring all (ms)'] = Date.now() - start;
	await page.keyboard.press('Escape');

	start = Date.now();
	results['long tasks while archiving all (ms)'] = await longTasks(page, async () => {
		await selectionBar.getByRole('button', { name: 'Archive' }).click();
		await expect(page.locator('[data-note-id]')).toHaveCount(0);
	});
	results['archiving all (ms)'] = Date.now() - start;
	results['sync after archiving all'] = await countRequests(page, () => syncNow(page));
});

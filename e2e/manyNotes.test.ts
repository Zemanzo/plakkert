import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { appendToNote, expect, note, syncNow, test, uniqueName, url, waitSynced } from './helpers';

const NOTE_COUNT = 120;

/** A Keep takeout with many notes, the newest first in the app: "Many note 0" is the oldest. */
function takeout() {
	const files: Record<string, Uint8Array> = {};
	for (let i = 0; i < NOTE_COUNT; i++) {
		files[`Takeout/Keep/${i}.json`] = strToU8(
			JSON.stringify({
				color: 'DEFAULT',
				isTrashed: false,
				isArchived: false,
				// One old note, far down the list, to search for.
				title: `Many note ${i}${i === 7 ? ' needle' : ''}`,
				textContent: 'Text',
				labels: [{ name: 'Many' }],
				createdTimestampUsec: (Date.UTC(2024, 0, 1) + i * 60_000) * 1000
			})
		);
	}
	return zipSync(files);
}

async function importNotes(page: Page) {
	await page.goto(url('/settings'));
	await page.locator('#import-keep').setInputFiles({
		name: 'takeout.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(takeout())
	});
	await page.getByRole('button', { name: `Import ${NOTE_COUNT} notes` }).click();
	await expect(page.locator('.importStatus')).toContainText(`Imported ${NOTE_COUNT} notes`);
}

const notes = (page: Page) => page.locator('[data-note-id]');

async function scrollToEnd(page: Page) {
	await page.locator('.scroll-container').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
}

test('many notes are shown a page at a time, and sync in a few requests', async ({ app }) => {
	const username = uniqueName('many');
	const { page } = await app.register(username);
	const batches: number[] = [];
	page.on('request', (request) => {
		if (request.url().endsWith('/api/notes/batch')) {
			batches.push((request.postDataJSON() as { notes: unknown[] }).notes.length);
		}
	});
	await importNotes(page);

	await test.step('they were sent to the server in a few requests', async () => {
		await page.goto(url('/'));
		await waitSynced(page);
		// Each note along with its tags, at most 100 at a time.
		expect(batches.reduce((sum, size) => sum + size, 0)).toBe(NOTE_COUNT);
		expect(batches.length).toBeLessThanOrEqual(3);
		expect(Math.max(...batches)).toBeLessThanOrEqual(100);
	});

	await test.step('only the first notes are shown, and more when scrolling down', async () => {
		await expect(notes(page)).toHaveCount(50);
		await expect(notes(page).first()).toContainText('Many note 119');
		// Closed notes are shown without an editor.
		await expect(page.locator('[contenteditable]')).toHaveCount(0);

		await scrollToEnd(page);
		await expect(notes(page)).toHaveCount(100);
		await scrollToEnd(page);
		await expect(notes(page)).toHaveCount(NOTE_COUNT);
	});

	await test.step('searching goes through all notes', async () => {
		await page.reload();
		await expect(notes(page)).toHaveCount(50);
		await page.getByRole('searchbox').fill('needle');
		await expect(notes(page)).toHaveText([/Many note 7 needle/]);
		await page.getByRole('searchbox').fill('');
		await expect(notes(page)).toHaveCount(50);
	});

	await test.step('and show up on another device, where changes come back from', async () => {
		const other = await app.login(username);
		await expect(notes(other.page)).toHaveCount(50);
		await appendToNote(other.page, 'Many note 119', ' changed elsewhere');
		await syncNow(other.page);

		await syncNow(page);
		await expect(note(page, 'Text changed elsewhere')).toBeVisible();
	});

	await test.step('all of them can be selected, also those not shown yet, and changed at once', async () => {
		await page.keyboard.press('ControlOrMeta+A');
		await expect(page.locator('.selectionBar')).toContainText(`${NOTE_COUNT} selected`);
		await expect(notes(page)).toHaveCount(50);

		const requests: string[] = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/api/notes')) {
				requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
			}
		});
		await page.locator('.selectionBar').getByRole('button', { name: 'Archive' }).click();
		await expect(page.getByText('No notes yet')).toBeVisible();
		await syncNow(page);
		// The tags of all of them, in two batches, rather than a request for each.
		expect(requests.filter((request) => request === 'POST /api/notes/batch')).toHaveLength(2);

		await page.goto(url('/archive'));
		await expect(notes(page)).toHaveCount(50);
		await scrollToEnd(page);
		await expect(notes(page)).toHaveCount(100);
	});

	await test.step('deleting them forever is sent in a few requests too', async () => {
		await page.keyboard.press('ControlOrMeta+A');
		await page.locator('.selectionBar').getByRole('button', { name: 'Move to trash' }).click();
		await syncNow(page);
		await page.goto(url('/trash'));
		await expect(notes(page)).toHaveCount(50);
		await page.keyboard.press('ControlOrMeta+A');
		await page.locator('.selectionBar').getByRole('button', { name: 'Delete forever' }).click();
		await expect(page.locator('dialog[open]')).toContainText(`Delete ${NOTE_COUNT} notes forever?`);

		const requests: string[] = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/api/notes')) {
				requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
			}
		});
		await page.locator('dialog[open]').getByRole('button', { name: 'Delete forever' }).click();
		await expect(page.getByText('The trash is empty.')).toBeVisible();
		await syncNow(page);
		expect(requests.filter((request) => request.startsWith('DELETE'))).toEqual([]);
		expect(requests.filter((request) => request === 'POST /api/notes/batch')).toHaveLength(2);
	});
});

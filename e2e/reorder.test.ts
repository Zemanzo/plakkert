import type { Page } from '@playwright/test';
import { expect, newNote, note, openedNote, syncNow, test, uniqueName } from './helpers';

const notes = (page: Page) => page.locator('[data-note-id]');

/** Drags a note with the mouse onto another one. */
async function drag(page: Page, from: string, to: string, finish = () => page.mouse.up()) {
	const source = (await note(page, from).boundingBox())!;
	const target = (await note(page, to).boundingBox())!;
	await page.mouse.move(source.x + source.width / 2, source.y + 60);
	await page.mouse.down();
	await page.mouse.move(target.x + target.width / 2, target.y + 60, { steps: 15 });
	// Let the other notes make room.
	await page.waitForTimeout(300);
	await finish();
}

test('on a touch screen, holding a note picks it up, and swiping scrolls', async ({
	app,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'Sends touches through the Chrome DevTools Protocol');
	const { page, context } = await app.register(uniqueName('touch'), {
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 700 }
	});
	for (const text of ['First', 'Second', 'Third', 'Fourth']) await newNote(page, text);
	await expect(notes(page)).toHaveText([/Fourth/, /Third/, /Second/, /First/]);

	// Playwright can only tap, so send the touches through the browser itself.
	const cdp = await context.newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
		});
	async function swipe(fromText: string, toY: (box: { y: number }) => number, holdMs: number) {
		const box = (await note(page, fromText).boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + 60;
		await touch('touchStart', x, y);
		await page.waitForTimeout(holdMs);
		const end = toY(box);
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', x, y + ((end - y) * i) / 10);
			await page.waitForTimeout(16);
		}
		await page.waitForTimeout(300);
		await touch('touchEnd', x, end);
	}

	await test.step('holding a note and then moving it reorders', async () => {
		// Both are on screen.
		const target = (await note(page, 'Fourth').boundingBox())!;
		await swipe('Third', () => target.y + 60, 600);
		await expect(notes(page)).toHaveText([/Third/, /Fourth/, /Second/, /First/]);
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('swiping right away scrolls instead', async () => {
		const scroller = page.locator('.scroll-container');
		await swipe('Fourth', (box) => box.y - 200, 0);
		await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		await expect(notes(page)).toHaveText([/Third/, /Fourth/, /Second/, /First/]);
		// Only the notes scroll, not the page around them.
		const pageHeight = await page.evaluate(() => document.scrollingElement!.scrollHeight);
		expect(pageHeight).toBeLessThanOrEqual(page.viewportSize()!.height);
	});
});

test('notes can be reordered by dragging them, and the order syncs', async ({ app }) => {
	const username = uniqueName('reorder');
	const { page } = await app.register(username);
	await newNote(page, 'First');
	await newNote(page, 'Second');
	await newNote(page, 'Third');
	await expect(notes(page)).toHaveText([/Third/, /Second/, /First/]);

	await test.step('dragging a note moves it, without opening it', async () => {
		await drag(page, 'First', 'Third');
		await expect(notes(page)).toHaveText([/First/, /Third/, /Second/]);
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('Escape cancels dragging', async () => {
		await drag(page, 'Second', 'First', async () => {
			await page.keyboard.press('Escape');
			await page.mouse.up();
		});
		await expect(notes(page)).toHaveText([/First/, /Third/, /Second/]);
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('Shift and the arrow keys move the selected note', async () => {
		await note(page, 'Second').focus();
		await page.keyboard.press('Shift+ArrowLeft');
		await expect(notes(page)).toHaveText([/First/, /Second/, /Third/]);
		await expect(note(page, 'Second')).toBeFocused();
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('clicking a note still opens it', async () => {
		await note(page, 'Third').click();
		await expect(openedNote(page)).toHaveText(/Third/);
		await page.keyboard.press('Escape');
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('the order stays after reloading, and new notes go first', async () => {
		await page.reload();
		await expect(notes(page)).toHaveText([/First/, /Second/, /Third/]);
		await newNote(page, 'Fourth');
		await expect(notes(page)).toHaveText([/Fourth/, /First/, /Second/, /Third/]);
	});

	await test.step('the order syncs to other devices', async () => {
		await syncNow(page);
		const other = await app.login(username);
		await expect(notes(other.page)).toHaveText([/Fourth/, /First/, /Second/, /Third/]);
	});
});

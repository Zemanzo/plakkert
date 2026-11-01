import {
	clickNoteButton,
	closeNote,
	expect,
	expectGone,
	goTo,
	newNote,
	note,
	openedNote,
	openNote,
	syncNow,
	test,
	uniqueName,
	url
} from './helpers';

test('a closed note can be scrolled, and still opens when clicked', async ({ app }) => {
	const { page } = await app.register(uniqueName('scroll'));
	await newNote(page, `Long note${'\nmore'.repeat(30)}`);
	const scroller = note(page, 'Long note').locator('.tipex-editor-section');
	expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

	await scroller.hover();
	await page.mouse.wheel(0, 300);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect(openedNote(page)).toHaveCount(0);

	await scroller.click();
	await expect(openedNote(page)).toHaveCount(1);
});

test('on a phone, an open note fills the screen and has a back button', async ({ app }) => {
	const { page } = await app.register(uniqueName('phone'));
	await newNote(page, 'Full screen');
	const back = page.getByRole('button', { name: 'Back to notes', exact: true });

	await test.step('on a wide screen, there is room around it to close it instead', async () => {
		await openNote(page, 'Full screen');
		await expect(back).toBeHidden();
		await closeNote(page);
	});

	await test.step('on a phone, it fills the screen', async () => {
		await page.setViewportSize({ width: 390, height: 760 });
		await openNote(page, 'Full screen');
		await expect
			.poll(async () => {
				const box = await openedNote(page).boundingBox();
				return box && [box.x, box.y, box.width, box.height].map(Math.round);
			})
			.toEqual([0, 0, 390, 760]);
		await back.click();
		await expect(openedNote(page)).toHaveCount(0);
	});
});

test('going back closes the open note, rather than leaving the page', async ({ app }) => {
	const { page } = await app.register(uniqueName('back'));
	await newNote(page, 'Some note');
	await page.goto(url('/archive'));
	await page.goto(url('/'));

	await openNote(page, 'Some note');
	await page.goBack();
	await expect(openedNote(page)).toHaveCount(0);
	await expect(page).toHaveURL(url('/'));

	// Closing it otherwise takes its history entry away again, so going back leaves the page.
	await openNote(page, 'Some note');
	await closeNote(page);
	await page.goBack();
	await expect(page).toHaveURL(url('/archive'));
});

test('on a touch screen, only new notes are focused when opened', async ({ app }) => {
	const { page } = await app.register(uniqueName('touch'), {
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 760 }
	});
	const editor = openedNote(page).locator('.ProseMirror');

	await page.getByRole('button', { name: /new note/i }).tap();
	await expect(editor).toBeFocused();
	await page.keyboard.type('Read me');
	await page.getByRole('button', { name: 'Back to notes', exact: true }).tap();
	await expect(openedNote(page)).toHaveCount(0);

	await note(page, 'Read me').tap();
	await expect(editor).toBeVisible();
	await page.waitForTimeout(500);
	await expect(editor).not.toBeFocused();
});

test('Escape closes a popover or dialog before the note', async ({ app }) => {
	const { page } = await app.register(uniqueName('escape'));
	await newNote(page, 'Buy milk');

	await test.step('in a popover', async () => {
		await openNote(page, 'Buy milk');
		await clickNoteButton(page, 'Tags');
		await page.locator('#tagOptions:popover-open').waitFor();
		await page.keyboard.press('Escape');
		await expect(page.locator('#tagOptions:popover-open')).toHaveCount(0);
		await expect(openedNote(page)).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('in the confirmation dialog', async () => {
		await openNote(page, 'Buy milk');
		await clickNoteButton(page, 'Move to trash');
		await expectGone(page, 'Buy milk');
		await goTo(page, 'Trash');
		await openNote(page, 'Buy milk');
		await openedNote(page).getByRole('button', { name: 'Delete forever' }).click();
		await page.locator('dialog[open]').waitFor();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(openedNote(page)).toHaveCount(1);
	});
});

test('a note being edited stays open, even when it stops matching the search', async ({ app }) => {
	const { page } = await app.register(uniqueName('search'));
	await newNote(page, 'Buy milk');
	await page.locator('input[type=search]').fill('milk');

	await openNote(page, 'Buy milk');
	await page.locator('.isFocused .ProseMirror').click();
	await page.keyboard.press('Control+A');
	await page.keyboard.type('Buy eggs');
	await page.waitForTimeout(800);
	await expect(openedNote(page)).toHaveCount(1);
	await expect(note(page, 'Buy eggs')).toBeVisible();

	// Once closed, it no longer matches.
	await closeNote(page);
	await expectGone(page, 'Buy eggs');
});

test('a note that is archived elsewhere while open closes', async ({ app }) => {
	const username = uniqueName('elsewhere');
	const { page } = await app.register(username);
	await newNote(page, 'Open note');
	await syncNow(page);

	const other = await app.login(username);
	await openNote(other.page, 'Open note');
	await openNote(page, 'Open note');
	await clickNoteButton(other.page, 'Archive');
	await syncNow(other.page);

	// The open note covers the sync status, so sync the way coming back online would.
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(page.locator('.modal-background')).toHaveCount(0);
	await expectGone(page, 'Open note');
});

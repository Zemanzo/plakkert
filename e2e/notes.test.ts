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
	uniqueName
} from './helpers';

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

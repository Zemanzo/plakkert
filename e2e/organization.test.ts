import {
	addTag,
	clickNoteButton,
	DAY_MS,
	expect,
	expectGone,
	goTo,
	navLink,
	newNote,
	note,
	noteAction,
	openedNote,
	openNote,
	openSharing,
	share,
	syncNow,
	syncStatus,
	test,
	uniqueName,
	url,
	closeNote
} from './helpers';

test('tags, the archive, the trash and search', async ({ app }) => {
	const { page } = await app.register(uniqueName('org'));
	await newNote(page, 'Groceries list');
	await newNote(page, 'Work plan');
	await newNote(page, 'Old stuff');

	await test.step('tagging a note creates the tag', async () => {
		// Whitespace around the name is ignored.
		await addTag(page, 'Work plan', '  Work ');
		await expect(note(page, 'Work plan').locator('.tag')).toHaveText(['Work']);
		await expect(navLink(page, 'Work')).toBeVisible();
	});

	await test.step('archiving can be undone', async () => {
		await noteAction(page, 'Old stuff', 'Archive');
		await page
			.locator('.toast', { hasText: 'Note archived' })
			.getByRole('button', { name: 'Undo' })
			.click();
		await expect(note(page, 'Old stuff')).toBeVisible();
	});

	await test.step('archived notes are only in the archive', async () => {
		await noteAction(page, 'Old stuff', 'Archive');
		await goTo(page, 'Archive');
		await page.waitForURL(url('/archive'));
		await expect(page.locator('[data-note-id]')).toHaveText([/Old stuff/]);
	});

	await test.step('notes in the trash are read-only and can be restored', async () => {
		await goTo(page, 'Notes');
		await noteAction(page, 'Groceries list', 'Move to trash');
		await goTo(page, 'Trash');
		await page.waitForURL(url('/trash'));
		await expect(note(page, 'Groceries list').locator('.info')).toHaveText(
			'Deleted forever in 30 days'
		);
		await openNote(page, 'Groceries list');
		await expect(page.locator('.isFocused .ProseMirror')).toHaveAttribute(
			'contenteditable',
			'false'
		);
		await openedNote(page).getByRole('button', { name: 'Restore' }).click();
		await expectGone(page, 'Groceries list');
		await goTo(page, 'Notes');
		await expect(note(page, 'Groceries list')).toBeVisible();
	});

	await test.step('search ignores case, and also finds archived notes and tags', async () => {
		const search = page.locator('input[type=search]');
		await page.keyboard.press('/');
		await expect(search).toBeFocused();
		await page.keyboard.type('PLAN');
		await expect(page.locator('[data-note-id]')).toHaveText([/Work plan/]);

		await search.fill('stuff');
		await expect(page.locator('.sectionHeading')).toHaveText('Archived');
		await expect(note(page, 'Old stuff')).toBeVisible();

		await search.fill('#work');
		await expect(page.locator('[data-note-id]')).toHaveText([/Work plan/]);

		await search.fill('nothing like this');
		await expect(page.getByText('No notes match')).toBeVisible();
		await search.press('Escape');
		await expect(search).toHaveValue('');
	});

	await test.step("a tag's view shows its notes, and new notes there get the tag", async () => {
		await goTo(page, 'Work');
		await page.waitForURL(/\?tag=Work$/);
		await expect(page.locator('[data-note-id]')).toHaveText([/Work plan/]);
		await newNote(page, 'Meeting notes');
		await expect(note(page, 'Meeting notes').locator('.tag')).toHaveText(['Work']);
	});

	await test.step('renaming a tag renames it everywhere, and follows it in the URL', async () => {
		await page.getByRole('button', { name: 'Edit tags' }).click();
		await page.getByRole('button', { name: 'Rename Work' }).click();
		await page.fill('input[aria-label="New name for Work"]', 'Job');
		await page.keyboard.press('Enter');
		await page.waitForURL(/\?tag=Job$/);
		await page.getByRole('button', { name: 'Done' }).click();
		await expect(note(page, 'Work plan').locator('.tag')).toHaveText(['Job']);
		await expect(note(page, 'Meeting notes').locator('.tag')).toHaveText(['Job']);
	});

	await test.step('a note can be deleted forever after confirming', async () => {
		await goTo(page, 'Notes');
		await noteAction(page, 'Meeting notes', 'Move to trash');
		await goTo(page, 'Trash');
		await openNote(page, 'Meeting notes');
		await openedNote(page).getByRole('button', { name: 'Delete forever' }).click();
		await page.locator('dialog[open]').getByRole('button', { name: 'Delete forever' }).click();
		await expect(page.getByText('The trash is empty.')).toBeVisible();
	});

	await test.step('deleting a tag removes it from its notes', async () => {
		await goTo(page, 'Notes');
		await page.getByRole('button', { name: 'Edit tags' }).click();
		await page.getByRole('button', { name: 'Delete Job' }).click();
		await page.locator('dialog[open]').getByRole('button', { name: 'Delete tag' }).click();
		await expect(page.locator('dialog[open]')).toContainText('You don’t have any tags');
		await page.getByRole('button', { name: 'Done' }).click();
		await expect(note(page, 'Work plan').locator('.tag')).toHaveCount(0);
	});
});

test('tags sync between devices, and are personal on shared notes', async ({ app }) => {
	const alice = uniqueName('alice');
	const bob = uniqueName('bob');
	const a = await app.register(alice);
	await newNote(a.page, 'Shared plan');
	await newNote(a.page, 'Archive me');
	await addTag(a.page, 'Shared plan', 'Ideas');
	await noteAction(a.page, 'Archive me', 'Archive');
	await syncNow(a.page);

	const other = await app.login(alice);

	await test.step('another device has the same tags and archive', async () => {
		await expect(note(other.page, 'Shared plan').locator('.tag')).toHaveText(['Ideas']);
		await expectGone(other.page, 'Archive me');
		await goTo(other.page, 'Archive');
		await expect(note(other.page, 'Archive me')).toBeVisible();
	});

	await test.step('unarchiving on one device unarchives on the other', async () => {
		await noteAction(other.page, 'Archive me', 'Unarchive');
		await syncNow(other.page);
		await syncNow(a.page);
		await expect(note(a.page, 'Archive me')).toBeVisible();
	});

	await test.step('on shared notes, everyone has their own tags and archive', async () => {
		const b = await app.register(bob);
		await openSharing(a.page, 'Shared plan');
		await share(a.page, bob, 'edit');
		await expect(a.page.locator('#shareOptions li', { hasText: bob })).toBeVisible();
		await closeNote(a.page);

		await syncNow(b.page);
		await expect(note(b.page, 'Shared plan')).toBeVisible();
		await expect(note(b.page, 'Shared plan').locator('.tag')).toHaveCount(0);

		await noteAction(b.page, 'Shared plan', 'Archive');
		await syncNow(b.page);
		await syncNow(a.page);
		await expect(note(a.page, 'Shared plan')).toBeVisible();
		await b.page.reload();
		await b.page.locator('input[type=search]').waitFor();
		await expectGone(b.page, 'Shared plan');
	});

	await test.step('archiving offline syncs once back online', async () => {
		await a.context.setOffline(true);
		await noteAction(a.page, 'Archive me', 'Archive');
		await expect(syncStatus(a.page)).toHaveText(/Offline/);
		await a.context.setOffline(false);
		await syncNow(a.page);
		await syncNow(other.page);
		await goTo(other.page, 'Notes');
		await expectGone(other.page, 'Archive me');
	});
});

test('notes in the trash for 30 days are deleted forever, on every device', async ({ app }) => {
	const username = uniqueName('purge');
	const a = await app.register(username);
	await newNote(a.page, 'Trash me');
	await newNote(a.page, 'Keep me');
	await noteAction(a.page, 'Trash me', 'Move to trash');
	await syncNow(a.page);

	// Another device, 31 days later.
	const later = await app.login(username, (page) =>
		page.clock.install({ time: Date.now() + 31 * DAY_MS })
	);
	await goTo(later.page, 'Trash');
	await expect(later.page.getByText('The trash is empty.')).toBeVisible();
	await syncNow(later.page);

	await syncNow(a.page);
	await goTo(a.page, 'Trash');
	await expect(a.page.getByText('The trash is empty.')).toBeVisible();
	await goTo(a.page, 'Notes');
	await expect(note(a.page, 'Keep me')).toBeVisible();
});

test('notes have colours', async ({ app }) => {
	const { page } = await app.register(uniqueName('colors'));
	await newNote(page, 'Colourful note');
	await openNote(page, 'Colourful note');
	await clickNoteButton(page, 'Pick color');
	await expect(page.locator('#colorSelection label')).toHaveCount(10);
	await page.locator('#colorSelection label[title=Purple]').click();
	await closeNote(page);
	await expect(note(page, 'Colourful note')).toHaveCSS('background-color', 'rgb(176, 140, 242)');
});

import {
	addTag,
	clickNoteButton,
	closeNote,
	expect,
	newNote,
	note,
	openedNote,
	test,
	uniqueName,
	url
} from './helpers';

test('notes can be hidden while closed, with a message in their place', async ({ app }) => {
	const { page } = await app.register(uniqueName('hidden'));
	await newNote(page, 'Secret plans');
	await newNote(page, 'Shopping list');
	await addTag(page, 'Secret plans', 'Private');
	const hidden = page.locator('[data-note-id]:has(.hiddenContent)');
	const bar = page.locator('.selectionBar');

	await test.step('selected notes can be hidden', async () => {
		await note(page, 'Secret plans').click({ modifiers: ['ControlOrMeta'] });
		await bar.getByRole('button', { name: 'Hide' }).click();
		await expect(hidden).toHaveCount(1);
		await expect(note(page, 'Secret plans')).toHaveCount(0);
		// Its color and tags still show.
		await expect(hidden.locator('.tag')).toHaveText(['Private']);
		await expect(note(page, 'Shopping list')).toBeVisible();
		// All selected notes are hidden, so the button shows them again instead.
		await expect(bar.getByRole('button', { name: 'Unhide' })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	await test.step('opening a hidden note shows its text', async () => {
		await hidden.click();
		await expect(openedNote(page)).toContainText('Secret plans');
	});

	await test.step('a message can be shown in place of the text', async () => {
		await clickNoteButton(page, 'Hide when closed');
		await expect(page.locator('#hideOptions').getByLabel('Hide when closed')).toBeChecked();
		await page.locator('#hideOptions').getByLabel('Message (optional)').fill('Birthday');
		await closeNote(page);
		await expect(hidden).toHaveText(/Birthday/);
		await expect(note(page, 'Secret plans')).toHaveCount(0);
	});

	await test.step('the message can be searched for', async () => {
		await page.getByRole('searchbox').fill('birthday');
		await expect(page.locator('[data-note-id]')).toHaveCount(1);
		await expect(hidden).toHaveCount(1);
		await page.getByRole('searchbox').fill('');
	});

	await test.step('a setting hides their tags too', async () => {
		await page.goto(url('/settings'));
		await page.getByLabel('Hide the tags of hidden notes').check();
		await page.getByRole('button', { name: 'Save Changes' }).click();
		await expect(page.getByText('All changes saved.')).toBeVisible();
		await page.goto(url('/'));
		await expect(hidden).toHaveText(/Birthday/);
		await expect(hidden.locator('.tag')).toHaveCount(0);
		await hidden.click();
		await expect(openedNote(page).locator('.tag')).toHaveText(['Private']);
	});

	await test.step('the note can be shown again from its menu', async () => {
		await clickNoteButton(page, 'Hide when closed');
		await page.locator('#hideOptions').getByLabel('Hide when closed').uncheck();
		await closeNote(page);
		await expect(hidden).toHaveCount(0);
		await expect(note(page, 'Secret plans')).toBeVisible();
	});

	await test.step('its message stays for when it’s hidden again, also when tags change', async () => {
		await note(page, 'Secret plans').click({ modifiers: ['ControlOrMeta'] });
		await bar.getByRole('button', { name: 'Tags' }).click();
		await page.fill('#selectionTags input[aria-label="Tag name"]', 'Extra');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		await bar.getByRole('button', { name: 'Hide' }).click();
		await expect(hidden).toHaveText(/Birthday/);
	});
});

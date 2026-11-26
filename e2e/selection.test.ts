import type { Page } from '@playwright/test';
import {
	expect,
	expectGone,
	goTo,
	newNote,
	note,
	openedNote,
	test,
	uniqueName,
	url
} from './helpers';

const bar = (page: Page) => page.locator('.selectionBar');
const barButton = (page: Page, name: string) => bar(page).getByRole('button', { name });
const tagsOf = (page: Page, text: string) => note(page, text).locator('.tag');

test('notes can be selected, and changed all at once', async ({ app }) => {
	const { page } = await app.register(uniqueName('select'));
	await newNote(page, 'First');
	await newNote(page, 'Second');
	await newNote(page, 'Third');

	await test.step('Ctrl-clicking a note selects it without opening it', async () => {
		await note(page, 'First').click({ modifiers: ['ControlOrMeta'] });
		await expect(openedNote(page)).toHaveCount(0);
		await expect(bar(page)).toContainText('1 selected');
		await expect(note(page, 'First')).toHaveAttribute('aria-pressed', 'true');
		// The selection's toolbar takes the place of the search field and the new note button.
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /new note/i })).toHaveCount(0);
	});

	await test.step('while selecting, clicking and Space select notes too', async () => {
		await note(page, 'Second').click();
		await expect(openedNote(page)).toHaveCount(0);
		await expect(bar(page)).toContainText('2 selected');
		await note(page, 'Third').focus();
		await page.keyboard.press('Space');
		await expect(bar(page)).toContainText('3 selected');
		await page.keyboard.press('Space');
		await expect(bar(page)).toContainText('2 selected');
		await expect(note(page, 'Third')).toHaveAttribute('aria-pressed', 'false');
	});

	await test.step('Escape stops selecting', async () => {
		await page.keyboard.press('Escape');
		await expect(bar(page)).toHaveCount(0);
		await expect(page.getByRole('searchbox')).toBeVisible();
		await expect(note(page, 'First')).not.toHaveAttribute('aria-pressed');
	});

	await test.step('Ctrl+Space selects the focused note', async () => {
		await note(page, 'Third').focus();
		await page.keyboard.press('ControlOrMeta+Space');
		await expect(bar(page)).toContainText('1 selected');
		await note(page, 'First').click({ modifiers: ['ControlOrMeta'] });
		await expect(bar(page)).toContainText('2 selected');
	});

	await test.step('the selected notes can be tagged', async () => {
		await barButton(page, 'Tags').click();
		await page.fill('#selectionTags input[aria-label="Tag name"]', 'Batch');
		await page.keyboard.press('Enter');
		await expect(tagsOf(page, 'First')).toHaveText(['Batch']);
		await expect(tagsOf(page, 'Third')).toHaveText(['Batch']);
		await expect(tagsOf(page, 'Second')).toHaveCount(0);
		await page.keyboard.press('Escape');

		// A tag only some of the selected notes have is shown as such, and checking it adds it to all.
		await note(page, 'Second').click();
		await barButton(page, 'Tags').click();
		const batch = page.locator('#selectionTags label', { hasText: 'Batch' }).locator('input');
		await expect(batch).toHaveAttribute('aria-checked', 'mixed');
		await batch.check();
		await expect(tagsOf(page, 'Second')).toHaveText(['Batch']);
		await expect(batch).toBeChecked();
		await batch.uncheck();
		await expect(page.locator('.tag')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(bar(page)).toContainText('3 selected');
	});

	await test.step('their color can be changed', async () => {
		await barButton(page, 'Pick color').click();
		await page.locator('#selectionColors label[title=Purple]').click();
		for (const text of ['First', 'Second', 'Third']) {
			await expect(note(page, text)).toHaveAttribute('style', /--color-purple/);
		}
		await page.keyboard.press('Escape');
	});

	await test.step('they can be archived, which can be undone', async () => {
		await note(page, 'Second').click();
		await expect(bar(page)).toContainText('2 selected');
		await barButton(page, 'Archive').click();
		await expectGone(page, 'First');
		await expectGone(page, 'Third');
		await expect(bar(page)).toHaveCount(0);
		await page
			.locator('.toast', { hasText: '2 notes archived' })
			.getByRole('button', { name: 'Undo' })
			.click();
		await expect(note(page, 'First')).toBeVisible();
		await expect(note(page, 'Third')).toBeVisible();
	});

	await test.step('Ctrl+A selects all notes, and they can be moved to the trash', async () => {
		await page.keyboard.press('ControlOrMeta+A');
		await expect(bar(page)).toContainText('3 selected');
		await barButton(page, 'Deselect all').click();
		// Without the select button, deselecting the last notes stops selecting.
		await expect(bar(page)).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+A');
		await expect(bar(page)).toContainText('3 selected');
		await barButton(page, 'Move to trash').click();
		await expect(page.getByText('No notes yet')).toBeVisible();
	});

	await test.step('in the trash, they can be restored or deleted forever', async () => {
		await goTo(page, 'Trash');
		await page.waitForURL(url('/trash'));
		await note(page, 'First').click({ modifiers: ['ControlOrMeta'] });
		await barButton(page, 'Restore').click();
		await expectGone(page, 'First');

		await page.keyboard.press('ControlOrMeta+A');
		await expect(bar(page)).toContainText('2 selected');
		await barButton(page, 'Delete forever').click();
		await expect(page.locator('dialog[open]')).toContainText('Delete 2 notes forever?');
		await page.locator('dialog[open]').getByRole('button', { name: 'Delete forever' }).click();
		await expect(page.getByText('The trash is empty.')).toBeVisible();

		await goTo(page, 'Notes');
		await expect(page.locator('[data-note-id]')).toHaveText([/First/]);
	});
});

test('Shift selects the notes from the one selected last', async ({ app }) => {
	const { page } = await app.register(uniqueName('select'));
	// Newest first: Note 6 to Note 1.
	for (let i = 1; i <= 6; i++) await newNote(page, `Note ${i}`);
	const isSelected = (n: number) => note(page, `Note ${n}`).getAttribute('aria-pressed');

	await test.step('without a selection, Shift-clicking selects just that note', async () => {
		await note(page, 'Note 5').click({ modifiers: ['Shift'] });
		await expect(bar(page)).toContainText('1 selected');
		await expect(openedNote(page)).toHaveCount(0);
	});

	await test.step('Shift-clicking another note selects the notes in between too', async () => {
		await note(page, 'Note 2').click({ modifiers: ['Shift'] });
		await expect(bar(page)).toContainText('4 selected');
		expect(await Promise.all([6, 5, 4, 3, 2, 1].map(isSelected))).toEqual([
			'false',
			'true',
			'true',
			'true',
			'true',
			'false'
		]);
		// Without selecting the text of the notes in between.
		expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
	});

	await test.step('it counts from the note selected last, in either direction', async () => {
		await note(page, 'Note 6').click({ modifiers: ['Shift'] });
		await expect(bar(page)).toContainText('5 selected');
		await note(page, 'Note 1').click({ modifiers: ['ControlOrMeta'] });
		await expect(bar(page)).toContainText('6 selected');
		await note(page, 'Note 3').click({ modifiers: ['ControlOrMeta'] });
		await note(page, 'Note 4').click({ modifiers: ['ControlOrMeta'] });
		await expect(bar(page)).toContainText('4 selected');
		await note(page, 'Note 2').focus();
		await page.keyboard.press('Shift+Space');
		await expect(bar(page)).toContainText('6 selected');
	});
});

test('on a touch screen, notes are selected after turning on selecting', async ({ app }) => {
	const { page } = await app.register(uniqueName('select'), {
		viewport: { width: 400, height: 800 },
		hasTouch: true,
		isMobile: true
	});
	await newNote(page, 'One');
	await newNote(page, 'Two');

	await page.getByRole('button', { name: 'Select notes' }).tap();
	await expect(bar(page)).toContainText('0 selected');
	await expect(barButton(page, 'Archive')).toBeDisabled();
	// On a narrow screen, the selection takes the navigation's place, and the actions show their name.
	await expect(page.locator('nav[aria-label=Notes]')).toBeHidden();
	await expect(barButton(page, 'Archive')).toHaveText('Archive');
	await note(page, 'One').tap();
	await note(page, 'Two').tap();
	await expect(bar(page)).toContainText('2 selected');
	await expect(openedNote(page)).toHaveCount(0);
	await note(page, 'Two').tap();
	await expect(bar(page)).toContainText('1 selected');

	await barButton(page, 'Select all').tap();
	await expect(bar(page)).toContainText('2 selected');
	await barButton(page, 'Stop selecting').tap();
	await expect(bar(page)).toHaveCount(0);
	await expect(page.locator('nav[aria-label=Notes]')).toBeVisible();

	// Tapping opens notes again.
	await note(page, 'One').tap();
	await expect(openedNote(page)).toHaveCount(1);
});

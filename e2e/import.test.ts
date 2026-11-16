import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, goTo, navLink, newNote, note, syncNow, test, uniqueName, url } from './helpers';

const keepNote = (fields: Record<string, unknown>) =>
	strToU8(
		JSON.stringify({
			color: 'DEFAULT',
			isTrashed: false,
			isPinned: false,
			isArchived: false,
			textContent: '',
			title: '',
			createdTimestampUsec: Date.UTC(2024, 0, 1) * 1000,
			userEditedTimestampUsec: Date.UTC(2024, 0, 2) * 1000,
			...fields
		})
	);

/** A Takeout like Google makes it, with a JSON and an HTML file for every note. */
const takeout = zipSync({
	'Takeout/archive_browser.html': strToU8('<html></html>'),
	'Takeout/Keep/Groceries.json': keepNote({
		color: 'RED',
		title: 'Groceries',
		textContent: undefined,
		listContent: [
			{ text: 'Apples', textHtml: '<p>Apples</p>', isChecked: true },
			{ text: 'Pears', textHtml: '<p>Pears</p>', isChecked: false }
		]
	}),
	'Takeout/Keep/Groceries.html': strToU8('<html></html>'),
	'Takeout/Keep/Recipe.json': keepNote({
		title: 'Spicy chicken',
		textContent: 'Soy sauce & garlic\nA few hours in the fridge',
		isArchived: true
	}),
	'Takeout/Keep/Old.json': keepNote({ title: 'Thrown away', isTrashed: true })
});

const importStatus = (page: Page) => page.locator('.importStatus');

async function importFile(page: Page, name: string, buffer: Buffer | Uint8Array) {
	await page.goto(url('/settings'));
	await page.locator('#import-keep').setInputFiles({
		name,
		mimeType: 'application/zip',
		buffer: Buffer.from(buffer)
	});
}

test('notes can be imported from a Google Keep takeout', async ({ app }) => {
	const username = uniqueName('import');
	const { page } = await app.register(username);
	await newNote(page, 'Already here');

	await test.step('importing tells what was imported', async () => {
		await importFile(page, 'takeout-20261116.zip', takeout);
		await expect(importStatus(page)).toHaveText(
			/Imported 2 notes, of which 1 to the archive\.\s*View them\s*Left out 1 note that was in the trash\./
		);
	});

	await test.step('they get the import tag', async () => {
		await page.getByRole('link', { name: 'View them' }).click();
		await expect(navLink(page, 'Keep import')).toHaveAttribute('aria-current', 'page');
		await expect(note(page, 'Groceries')).toBeVisible();
		await expect(note(page, 'Spicy chicken')).toBeVisible();
		await expect(note(page, 'Already here')).toHaveCount(0);
	});

	await test.step('with their text, checklists and colour, but no formatting', async () => {
		await goTo(page, 'Notes');
		const groceries = note(page, 'Groceries');
		await expect(groceries.locator('h1')).toHaveText('Groceries');
		await expect(groceries.locator('li[data-checked="true"] p')).toHaveText('Apples');
		await expect(groceries.locator('li[data-checked="false"] p')).toHaveText('Pears');
		await expect(groceries).toHaveAttribute('style', /--color-red/);
		// They keep their date, so they're ordered among the other notes by when they were written.
		await expect(page.locator('[data-note-id]')).toHaveText([/Already here/, /Groceries/]);
	});

	await test.step('archived notes go to the archive', async () => {
		await goTo(page, 'Archive');
		const recipe = note(page, 'Spicy chicken');
		await expect(recipe.locator('p')).toHaveText([
			'Soy sauce & garlic',
			'A few hours in the fridge'
		]);
		await expect(recipe).toHaveAttribute('style', /--color-yellow/);
	});

	await test.step('they sync to other devices', async () => {
		await syncNow(page);
		const other = await app.login(username);
		await expect(note(other.page, 'Groceries')).toBeVisible();
		await goTo(other.page, 'Archive');
		await expect(note(other.page, 'Spicy chicken')).toBeVisible();
	});
});

test('importing something that is not a Keep takeout explains why', async ({ app }) => {
	const { page } = await app.register(uniqueName('badImport'));

	await importFile(page, 'notes.zip', strToU8('not a zip'));
	await expect(importStatus(page)).toHaveText('This file isn’t a .zip file, or it’s damaged.');

	await importFile(page, 'photos.zip', zipSync({ 'Takeout/Photos/photo.jpg': new Uint8Array(4) }));
	await expect(importStatus(page)).toHaveText('There are no Google Keep notes in this file.');
});

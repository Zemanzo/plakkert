import { readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { addTag, expect, newNote, noteAction, test, uniqueName, url } from './helpers';

async function download(page: Page) {
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export', exact: true }).click()
	]);
	expect(file.suggestedFilename()).toMatch(/^Plakkert \d{4}-\d\d-\d\d \d\d\.\d\d\.zip$/);
	return new Blob([await readFile((await file.path())!)]);
}

async function readZip(zip: Blob, password?: string) {
	const reader = new ZipReader(new BlobReader(zip), { password });
	const files: Record<string, string> = {};
	for (const entry of await reader.getEntries()) {
		if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter());
	}
	await reader.close();
	return files;
}

test('all notes can be exported as a zip, with or without a password', async ({ app }) => {
	const { page } = await app.register(uniqueName('export'));
	await newNote(page, 'Groceries');
	await newNote(page, 'Old idea');
	await newNote(page, 'Thrown away');
	await addTag(page, 'Groceries', 'Home');
	await noteAction(page, 'Old idea', 'Archive');
	await noteAction(page, 'Thrown away', 'Move to trash');

	await page.goto(url('/settings'));
	const exportButton = page.getByRole('button', { name: 'Export', exact: true });

	await test.step('without a password', async () => {
		await page.getByLabel('Without a password').check();
		await expect(page.getByText('Anyone who gets hold of the file')).toBeVisible();
		const files = await readZip(await download(page));
		expect(Object.keys(files).sort()).toEqual([
			'Archive/Old idea.md',
			'Notes/Groceries.md',
			'Trash/Thrown away.md'
		]);
		expect(files['Notes/Groceries.md']).toMatch(/^---\ntags: \["Home"\]\n/);
		expect(files['Notes/Groceries.md']).toMatch(/Groceries\s*$/);
		await expect(page.getByText('Exported 3 notes.')).toBeVisible();
	});

	await test.step('with a password', async () => {
		await page.getByLabel('With a password').check();
		await expect(exportButton).toBeDisabled();
		await page.getByLabel('Password', { exact: true }).fill('short');
		await expect(page.getByText('at least 8 characters')).toBeVisible();
		await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
		await page.getByLabel('Repeat password').fill('correct horse');
		await expect(page.getByText('The passwords don’t match.')).toBeVisible();
		await expect(exportButton).toBeDisabled();
		await page.getByLabel('Repeat password').fill('correct horse battery');

		const zip = await download(page);
		await expect(readZip(zip, 'wrong password')).rejects.toThrow();
		const files = await readZip(zip, 'correct horse battery');
		const names = Object.keys(files);
		expect(names).toHaveLength(3);
		// Named after when they were created, as file names aren't encrypted.
		for (const name of names) expect(name).toMatch(/^(Notes|Archive|Trash)\/\d{4}-\d\d-\d\d /);
		expect(Object.values(files).join()).toContain('Groceries');
		const raw = new TextDecoder().decode(await zip.arrayBuffer());
		expect(raw).not.toContain('Groceries');
	});
});

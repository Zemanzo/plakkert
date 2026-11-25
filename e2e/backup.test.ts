import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
	deleteForever,
	expect,
	INVITE_CODE,
	newNote,
	note,
	PASSWORD,
	syncNow,
	test,
	uniqueName,
	url,
	waitSynced
} from './helpers';
import { callTool, connect, toolNames } from './mcpClient';

// Backups: a copy of everything of a user's on the server, still encrypted, to restore into the
// same account, or into a new one.

/** Downloads a backup from the settings, and returns the file. */
async function downloadBackup(page: Page) {
	await page.goto(url('/settings'));
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download a backup' }).click()
	]);
	expect(file.suggestedFilename()).toMatch(/^plakkert-backup-\d{4}-\d\d-\d\d\.zip$/);
	return readFile((await file.path())!);
}

/** Restores a backup from the settings, and returns what it says it did. */
async function restoreBackup(page: Page, zip: Buffer) {
	await page.goto(url('/settings'));
	await page.locator('#backup-restore').setInputFiles({
		name: 'backup.zip',
		mimeType: 'application/zip',
		buffer: zip
	});
	const status = page.locator('.backup .status');
	await expect(status).not.toHaveText(/…/);
	return status;
}

test('a backup brings deleted notes back, on every device', async ({ app }) => {
	const username = uniqueName('backup');
	const a = await app.register(username);
	await newNote(a.page, 'A note to keep');
	await newNote(a.page, 'A note deleted by mistake');
	await waitSynced(a.page);
	const b = await app.login(username);
	await expect(note(b.page, 'A note deleted by mistake')).toBeVisible();

	const zip = await downloadBackup(a.page);

	await test.step('the note is deleted forever, everywhere', async () => {
		await a.page.goto(url('/'));
		await deleteForever(a.page, 'A note deleted by mistake');
		await waitSynced(a.page);
		await syncNow(b.page);
		await expect(note(b.page, 'A note deleted by mistake')).toHaveCount(0);
	});

	await test.step('restoring the backup brings it back', async () => {
		await expect(await restoreBackup(a.page, zip)).toHaveText('Brought back 1 note.');
		await a.page.goto(url('/'));
		await expect(note(a.page, 'A note deleted by mistake')).toBeVisible();
		await expect(note(a.page, 'A note to keep')).toHaveCount(1);
	});

	await test.step('also on the other device, which had deleted it', async () => {
		await syncNow(b.page);
		await expect(note(b.page, 'A note deleted by mistake')).toBeVisible();
	});

	await test.step('restoring it again changes nothing', async () => {
		await expect(await restoreBackup(a.page, zip)).toHaveText(
			'Everything in the backup was already there.'
		);
	});

	await test.step('another account can’t restore it', async () => {
		const other = await app.register(uniqueName('other'));
		await expect(await restoreBackup(other.page, zip)).toHaveText(/This backup is of another/);
	});
});

test('a new account can be made from a backup', async ({ app }) => {
	const old = await app.register(uniqueName('old'));
	await newNote(old.page, 'Written in the old account');
	await waitSynced(old.page);
	const zip = await downloadBackup(old.page);

	const { page } = await app.open('new device');
	await page.goto(url('/register'));
	await page.locator('#backup').setInputFiles({
		name: 'backup.zip',
		mimeType: 'application/zip',
		buffer: zip
	});
	await expect(page.getByText(/^From the backup of/)).toBeVisible();
	// The old account is on this server too, so the new one needs another name.
	await page.fill('#username', uniqueName('restored'));
	await page.fill('#inviteCode', INVITE_CODE);

	await test.step('only with the password the backup was made with', async () => {
		await page.fill('#password', 'not the password');
		await page.getByRole('button', { name: 'Register and restore' }).click();
		await expect(
			page.getByText('That isn’t the password this backup was made with.')
		).toBeVisible();
	});

	await test.step('then it has the backup’s notes', async () => {
		await page.fill('#password', PASSWORD);
		await page.getByRole('button', { name: 'Register and restore' }).click();
		await page.waitForURL(url('/'));
		await expect(note(page, 'Written in the old account')).toBeVisible();
	});

	await test.step('which are copies: the old account’s stay as they are', async () => {
		await old.page.goto(url('/'));
		await syncNow(old.page);
		await expect(note(old.page, 'Written in the old account')).toHaveCount(1);
	});
});

test('MCP clients can make and restore backups, if the user lets them', async ({
	app,
	request
}) => {
	const { page } = await app.register(uniqueName('mcpbackup'));
	await newNote(page, 'Backed up by an app');
	await waitSynced(page);

	const reader = await connect(page, request, {}, 'Reader');
	expect(await toolNames(request, reader.access_token)).not.toContain('export_backup');
	const { access_token } = await connect(page, request, { read: false, backup: true }, 'Backups');
	expect(await toolNames(request, access_token)).toEqual([
		'export_backup',
		'restore_backup',
		'start_backup_import'
	]);

	const exported = await callTool(request, access_token, 'export_backup');
	expect(exported.isError, exported.content[0]?.text).toBeFalsy();
	const download = await request.get(exported.structuredContent.url as string);
	expect(download.status()).toBe(200);
	const zip = await download.body();

	await page.goto(url('/'));
	await deleteForever(page, 'Backed up by an app');
	await waitSynced(page);

	const started = await callTool(request, access_token, 'start_backup_import');
	const {
		url: uploadUrl,
		upload_id,
		chunk_size
	} = started.structuredContent as {
		url: string;
		upload_id: string;
		chunk_size: number;
	};
	for (let offset = 0; offset < zip.length; offset += chunk_size) {
		const piece = await request.put(`${uploadUrl}?offset=${offset}`, {
			headers: { 'content-type': 'application/octet-stream' },
			data: zip.subarray(offset, offset + chunk_size)
		});
		expect(piece.status(), await piece.text()).toBe(200);
	}
	const restored = await callTool(request, access_token, 'restore_backup', { upload_id });
	expect(restored.isError, restored.content[0]?.text).toBeFalsy();
	expect(restored.structuredContent).toMatchObject({
		restored: 1,
		message: 'Brought back 1 note.'
	});

	await syncNow(page);
	await expect(note(page, 'Backed up by an app')).toBeVisible();

	await test.step('the download link stops working once the app’s access is gone', async () => {
		const again = await callTool(request, access_token, 'export_backup');
		await page.goto(url('/settings'));
		const row = page.getByRole('listitem', { name: 'Backups', exact: true });
		await row.getByRole('button', { name: 'Disconnect' }).click();
		await expect(row).toHaveCount(0);
		expect((await request.get(again.structuredContent.url as string)).status()).toBe(404);
	});
});

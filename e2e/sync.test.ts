import {
	appendToNote,
	deleteForever,
	expect,
	expectGone,
	newNote,
	note,
	syncNow,
	syncStatus,
	test,
	uniqueName,
	waitSynced
} from './helpers';

test('notes sync between devices, also after being offline', async ({ app }) => {
	const username = uniqueName('sync');
	const a = await app.register(username);
	await newNote(a.page, 'From A');
	await syncNow(a.page);

	const b = await app.login(username);

	await test.step('a new device gets the notes', async () => {
		await expect(note(b.page, 'From A')).toBeVisible();
	});

	await test.step('edits reach the other device', async () => {
		await appendToNote(b.page, 'From A', ' edited on B');
		await syncNow(b.page);
		await syncNow(a.page);
		await expect(note(a.page, 'From A edited on B')).toBeVisible();
	});

	await test.step('notes created offline are sent once back online', async () => {
		await a.context.setOffline(true);
		await newNote(a.page, 'Offline note');
		await appendToNote(a.page, 'Offline note', ' plus more');
		await expect(syncStatus(a.page)).toHaveText(/Offline · 1 unsynced change/);
		await a.context.setOffline(false);
		// Coming back online syncs by itself.
		await waitSynced(a.page);
		await syncNow(b.page);
		await expect(note(b.page, 'Offline note plus more')).toBeVisible();
	});

	await test.step('a note created and deleted offline never reaches the server', async () => {
		await a.context.setOffline(true);
		await newNote(a.page, 'Short-lived');
		await deleteForever(a.page, 'Short-lived');
		await a.context.setOffline(false);
		await waitSynced(a.page);
		const serverNotes = await a.page.evaluate(async () => (await fetch('/api/notes')).json());
		expect(serverNotes).toHaveLength(2);
	});

	await test.step('deleting on one device deletes on the other', async () => {
		await deleteForever(b.page, 'Offline note');
		await syncNow(b.page);
		await syncNow(a.page);
		await expectGone(a.page, 'Offline note');
	});

	await test.step('of conflicting offline edits, the later one wins on both devices', async () => {
		await a.context.setOffline(true);
		await b.context.setOffline(true);
		await appendToNote(a.page, 'From A', ' then A offline');
		await appendToNote(b.page, 'From A', ' then B offline');
		await a.context.setOffline(false);
		await waitSynced(a.page);
		await b.context.setOffline(false);
		await waitSynced(b.page);
		await syncNow(a.page);

		const texts = async (page: typeof a.page) =>
			(await page.locator('[data-note-id]').allInnerTexts()).join('|');
		const onA = await texts(a.page);
		expect(onA).toContain('then B offline');
		expect(onA).not.toContain('then A offline');
		expect(await texts(b.page)).toBe(onA);
	});
});

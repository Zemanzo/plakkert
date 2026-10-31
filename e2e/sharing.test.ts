import {
	appendToNote,
	clickNoteButton,
	closeNote,
	deleteForever,
	expect,
	expectGone,
	newNote,
	note,
	openedNote,
	openNote,
	openSharing,
	share,
	syncNow,
	syncStatus,
	test,
	uniqueName,
	waitSynced
} from './helpers';

test('sharing notes with view and edit permissions', async ({ app }) => {
	const alice = uniqueName('alice');
	// Usernames are case-insensitive; sharing should work however it's typed.
	const bob = uniqueName('Bob');
	const bobLower = bob.toLowerCase();
	const a = await app.register(alice);
	const b = await app.register(bob);

	await newNote(a.page, 'Shared note');

	await test.step('sharing with an unknown user shows an error', async () => {
		// Sharing right away also checks that a note is synced before it's shared.
		await openSharing(a.page, 'Shared note');
		await share(a.page, 'nobody-by-this-name', 'view');
		await expect(a.page.locator('#shareOptions .error')).toContainText('There is no user called');
	});

	await test.step('a view-only recipient can read but not edit, recolor or share', async () => {
		await share(a.page, bob, 'view');
		await expect(a.page.locator('#shareOptions li', { hasText: bobLower })).toBeVisible();
		await closeNote(a.page);

		await syncNow(b.page);
		await expect(note(b.page, `Shared by ${alice} · view only`)).toBeVisible();
		await openNote(b.page, 'Shared note');
		await expect(b.page.locator('.isFocused .ProseMirror')).toHaveAttribute(
			'contenteditable',
			'false'
		);
		await expect(openedNote(b.page).getByRole('button', { name: 'Pick color' })).toHaveCount(0);
		await expect(openedNote(b.page).getByRole('button', { name: 'Share' })).toHaveCount(0);
		await closeNote(b.page);
	});

	await test.step("the owner's edits reach the recipient", async () => {
		await appendToNote(a.page, 'Shared note', ' updated by alice');
		await syncNow(a.page);
		await syncNow(b.page);
		await expect(note(b.page, 'Shared note updated by alice')).toBeVisible();
	});

	await test.step('after being allowed to edit, the recipient’s edits reach the owner', async () => {
		await openSharing(a.page, 'Shared note');
		await a.page.selectOption(
			`#shareOptions select[aria-label="Permission of ${bobLower}"]`,
			'edit'
		);
		await a.page.waitForTimeout(1000);
		await closeNote(a.page);
		await syncNow(b.page);
		await expect(
			b.page.locator('.details .info', { hasText: `Shared by ${alice}` })
		).not.toContainText('view only');
		await appendToNote(b.page, 'Shared note', ' and bob');
		await syncNow(b.page);
		await syncNow(a.page);
		await expect(note(a.page, 'Shared note updated by alice and bob')).toBeVisible();
	});

	await test.step('stopping sharing removes the note for the recipient', async () => {
		await openSharing(a.page, 'Shared note');
		await a.page.click(`#shareOptions button[aria-label="Stop sharing with ${bobLower}"]`);
		await expect(a.page.locator('#shareOptions')).toContainText('Not shared with anyone yet.');
		await closeNote(a.page);
		await syncNow(b.page);
		await expectGone(b.page, 'Shared note');
	});

	await test.step('the recipient can remove it from their notes; the owner keeps it', async () => {
		await openSharing(a.page, 'Shared note');
		await share(a.page, bob, 'edit');
		await expect(a.page.locator('#shareOptions li', { hasText: bobLower })).toBeVisible();
		await closeNote(a.page);
		await syncNow(b.page);
		await deleteForever(b.page, 'Shared note');
		await syncNow(b.page);
		await b.page.reload();
		await waitSynced(b.page);
		await expectGone(b.page, 'Shared note');

		await openSharing(a.page, 'Shared note');
		await expect(a.page.locator('#shareOptions')).toContainText('Not shared with anyone yet.');
		await closeNote(a.page);
	});

	await test.step('when the owner deletes it forever, it’s gone for the recipient too', async () => {
		await openSharing(a.page, 'Shared note');
		await share(a.page, bob, 'view');
		await expect(a.page.locator('#shareOptions li', { hasText: bobLower })).toBeVisible();
		await closeNote(a.page);
		await syncNow(b.page);
		await expect(note(b.page, 'Shared note')).toBeVisible();
		await deleteForever(a.page, 'Shared note');
		await syncNow(a.page);
		await syncNow(b.page);
		await expectGone(b.page, 'Shared note');
	});
});

test('editing a shared note offline', async ({ app }) => {
	const alice = uniqueName('alice');
	const bob = uniqueName('bob');
	const a = await app.register(alice);
	const b = await app.register(bob);

	async function setPermission(permission: 'view' | 'edit') {
		await openSharing(a.page, 'Team note');
		await share(a.page, bob, permission);
		await expect(a.page.locator('#shareOptions li', { hasText: bob })).toBeVisible();
		await a.page.waitForTimeout(500);
		await closeNote(a.page);
	}

	await newNote(a.page, 'Team note');
	await setPermission('edit');
	await syncNow(b.page);
	await expect(note(b.page, 'Team note')).toBeVisible();

	await test.step("the recipient's offline edit reaches the owner", async () => {
		await b.context.setOffline(true);
		await appendToNote(b.page, 'Team note', ' offline by bob');
		await expect(syncStatus(b.page)).toHaveText(/Offline · 1 unsynced change/);
		await b.context.setOffline(false);
		await waitSynced(b.page);
		await syncNow(a.page);
		await expect(note(a.page, 'Team note offline by bob')).toBeVisible();
	});

	await test.step('an offline edit after losing edit access is dropped, and sync recovers', async () => {
		await b.context.setOffline(true);
		await appendToNote(b.page, 'Team note offline by bob', ' (too late)');
		await setPermission('view');
		await b.context.setOffline(false);
		await waitSynced(b.page);
		await syncNow(b.page);
		await expect(b.page.locator('.details .info', { hasText: 'view only' })).toBeVisible();
		await expect(note(b.page, 'Team note')).not.toContainText('too late');
	});
});

test('the share form can be used right after opening it', async ({ app }) => {
	const { page } = await app.register(uniqueName('focus'));
	await newNote(page, 'Note text');
	await openNote(page, 'Note text');
	await clickNoteButton(page, 'Share');
	await page.locator('#shareOptions:popover-open').waitFor();

	// Click like a person would, rather than focusing the field directly.
	const input = page.locator('#shareOptions input[aria-label=Username]');
	const box = await input.boundingBox();
	await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.keyboard.type('somebody');

	await expect(input).toHaveValue('somebody');
	await expect(page.locator('.isFocused .ProseMirror')).not.toContainText('somebody');
});

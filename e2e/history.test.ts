import type { Page } from '@playwright/test';
import {
	appendToNote,
	closeNote,
	expect,
	newNote,
	note,
	openedNote,
	openNote,
	openSharing,
	share,
	syncNow,
	test,
	uniqueName,
	url
} from './helpers';

/** Turns note history on or off in the settings, and goes back to the notes. */
async function setHistory(page: Page, on: boolean) {
	await page.goto(url('/settings'));
	const toggle = page.getByLabel('Keep the history of notes');
	await expect(toggle).toBeEnabled();
	if (on) {
		await toggle.check();
	} else {
		await toggle.uncheck();
		await page.locator('dialog[open]').getByRole('button', { name: 'Turn off and delete' }).click();
	}
	await expect(toggle).toBeChecked({ checked: on });
	await expect(toggle).toBeEnabled();
	await page.goto(url('/'));
	await page.getByRole('button', { name: /new note/i }).waitFor();
}

/**
 * Moves the device's clock ahead, as far as `Date.now()` goes, which is what saving a note uses,
 * e.g. to start another session of editing. Until the page is loaded again. (Playwright's clock
 * would do more, but the dates it makes can't be stored in IndexedDB.)
 */
async function moveClockAhead(page: Page, minutes: number) {
	await page.evaluate(
		(ms) => {
			const clock = window as unknown as { realNow?: () => number; offset?: number };
			clock.realNow ??= Date.now.bind(Date);
			clock.offset = (clock.offset ?? 0) + ms;
			Date.now = () => clock.realNow!() + clock.offset!;
		},
		minutes * 60 * 1000
	);
}

const historyButton = (page: Page) =>
	openedNote(page).getByRole('button', { name: 'View history' });
const historyDialog = (page: Page) => page.locator('dialog[open]', { hasText: 'History' });
const versionButtons = (page: Page) => historyDialog(page).locator('.versions button');

/** Opens a note's history, and waits until it's loaded. */
async function openHistory(page: Page, text: string) {
	await openNote(page, text);
	await historyButton(page).click();
	await expect(historyDialog(page)).toBeVisible();
	await expect(historyDialog(page).getByText('Loading…')).toHaveCount(0);
}

async function closeHistory(page: Page) {
	await historyDialog(page).getByRole('button', { name: 'Close' }).click();
	await expect(historyDialog(page)).toHaveCount(0);
	await closeNote(page);
}

/** The versions of a note that the server gives the user. */
const serverVersions = async (page: Page, text: string) => {
	const id = await note(page, text).first().getAttribute('data-note-id');
	return page.evaluate(async (noteId) => {
		const response = await fetch(`/api/notes/${noteId}/versions`);
		return (await response.json()) as { since: number | null; versions: unknown[] };
	}, id);
};

/** How many versions are kept on the device, for any note. */
const localVersionCount = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const open = indexedDB.open('plakkert');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const request = open.result
						.transaction('noteVersions')
						.objectStore('noteVersions')
						.count();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						open.result.close();
						resolve(request.result);
					};
				};
			})
	);

test('notes keep a history to go back to, also offline', async ({ app }) => {
	const { page, context } = await app.register(uniqueName('history'));

	await test.step('an open note shows when it was edited, without history by default', async () => {
		await newNote(page, 'First draft');
		await openNote(page, 'First draft');
		await expect(openedNote(page).locator('.edited')).toContainText('Edited');
		await expect(historyButton(page)).toHaveCount(0);
		await closeNote(page);
	});

	await setHistory(page, true);

	await test.step('the note is kept as it was before a later session of editing', async () => {
		await openHistory(page, 'First draft');
		await expect(historyDialog(page)).toContainText('There are no earlier versions yet');
		await closeHistory(page);

		await moveClockAhead(page, 11);
		await appendToNote(page, 'First draft', ', changed');
		await syncNow(page);
		await openHistory(page, 'First draft, changed');
		await expect(versionButtons(page)).toHaveCount(2);
		await expect(historyDialog(page).locator('.preview')).toHaveText('First draft');
		await versionButtons(page).first().click();
		await expect(historyDialog(page).locator('.preview')).toHaveText('First draft, changed');
	});

	await test.step('restoring brings the version back, and keeps what it replaced', async () => {
		await versionButtons(page).nth(1).click();
		await historyDialog(page).getByRole('button', { name: 'Restore this version' }).click();
		await expect(historyDialog(page)).toHaveCount(0);
		await expect(openedNote(page).locator('.ProseMirror')).toHaveText('First draft');
		await expect(page.locator('.toast', { hasText: 'Restored the version of' })).toBeVisible();
		await historyButton(page).click();
		await expect(versionButtons(page)).toHaveCount(3);
		await expect(historyDialog(page).locator('.preview')).toHaveText('First draft, changed');
		await closeHistory(page);
		await syncNow(page);
		const { versions } = await serverVersions(page, 'First draft');
		expect(versions).toHaveLength(2);
	});

	await test.step('the history can be seen offline', async () => {
		await context.setOffline(true);
		await openHistory(page, 'First draft');
		await expect(historyDialog(page)).toContainText('You’re offline');
		await expect(versionButtons(page)).toHaveCount(3);
		await closeHistory(page);
		await context.setOffline(false);
	});
});

test('an edit that loses to a newer one stays in the history', async ({ app }) => {
	const username = uniqueName('lost');
	const a = await app.register(username);
	await setHistory(a.page, true);
	await newNote(a.page, 'Plan');
	await syncNow(a.page);
	const b = await app.login(username);
	await expect(note(b.page, 'Plan')).toBeVisible();

	await b.context.setOffline(true);
	await appendToNote(b.page, 'Plan', ' from B');
	await appendToNote(a.page, 'Plan', ' from A');
	await syncNow(a.page);
	await b.context.setOffline(false);
	await syncNow(b.page);
	await expect(note(b.page, 'Plan from A')).toBeVisible();
	// The version is sent with the next sync.
	await syncNow(b.page);

	// On the other device, too.
	await openHistory(a.page, 'Plan from A');
	await expect(versionButtons(a.page)).toHaveCount(2);
	await expect(historyDialog(a.page).locator('.preview')).toHaveText('Plan from B');
	await closeHistory(a.page);
});

test('history follows the owner, and turning it off deletes it everywhere', async ({ app }) => {
	const owner = uniqueName('owner');
	const friend = uniqueName('friend');
	const a = await app.register(owner);
	const b = await app.register(friend);
	await setHistory(a.page, true);
	await setHistory(b.page, true);
	const other = await app.login(owner);

	await test.step('the owner’s devices keep versions', async () => {
		await newNote(a.page, 'Shared plan');
		await syncNow(a.page);
		await syncNow(other.page);
		await moveClockAhead(other.page, 11);
		await appendToNote(other.page, 'Shared plan', ' v2');
		await openHistory(other.page, 'Shared plan v2');
		await expect(versionButtons(other.page)).toHaveCount(2);
		await closeHistory(other.page);
		await syncNow(other.page);
		expect((await serverVersions(a.page, 'Shared plan')).versions).toHaveLength(1);
	});

	await test.step('people it’s shared with only see versions from after that', async () => {
		await syncNow(a.page);
		await openSharing(a.page, 'Shared plan v2');
		await share(a.page, friend, 'edit');
		await expect(
			a.page.locator('#shareOptions li', { hasText: friend.toLowerCase() })
		).toBeVisible();
		await closeNote(a.page);
		await syncNow(b.page);
		await openHistory(b.page, 'Shared plan v2');
		await expect(historyDialog(b.page)).toContainText('There are no earlier versions yet');
		await closeHistory(b.page);
	});

	await test.step('turning it off deletes the history on the server and the devices', async () => {
		expect(await localVersionCount(other.page)).toBeGreaterThan(0);
		await setHistory(a.page, false);
		expect(await serverVersions(a.page, 'Shared plan')).toEqual({ since: null, versions: [] });
		expect(await localVersionCount(a.page)).toBe(0);
		await syncNow(other.page);
		expect(await localVersionCount(other.page)).toBe(0);
		await openNote(other.page, 'Shared plan');
		await expect(historyButton(other.page)).toHaveCount(0);
		await closeNote(other.page);
	});

	await test.step('so people it’s shared with don’t see a history either', async () => {
		await syncNow(b.page);
		await openNote(b.page, 'Shared plan');
		await expect(historyButton(b.page)).toHaveCount(0);
		await closeNote(b.page);
	});
});

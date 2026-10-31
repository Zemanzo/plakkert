import {
	test as base,
	expect,
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	type Page
} from '@playwright/test';

export { expect };

export const BASE_URL = 'http://localhost:4173';
export const PASSWORD = 'correct horse battery staple';
export const DAY_MS = 24 * 60 * 60 * 1000;

export const url = (path: string) => new URL(path, BASE_URL).href;

/** A username no other test uses, so tests can share one server and database. */
export function uniqueName(prefix: string) {
	return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Errors that are expected, e.g. while a device is offline. */
const EXPECTED_ERRORS = [/Failed to load resource/, /ERR_INTERNET_DISCONNECTED/, /Login failed/];

export interface Device {
	context: BrowserContext;
	page: Page;
}

/**
 * Opens browser contexts, which act as separate devices, and collects errors
 * from their pages. A test fails if any page logged an unexpected error.
 */
class Devices {
	readonly errors: string[] = [];
	readonly #browser: Browser;
	readonly #contexts: BrowserContext[] = [];

	constructor(browser: Browser) {
		this.#browser = browser;
	}

	async open(label: string, options: BrowserContextOptions = {}): Promise<Device> {
		const context = await this.#browser.newContext(options);
		this.#contexts.push(context);
		const page = await context.newPage();
		page.on('pageerror', (error) => this.errors.push(`${label}: ${error.message}`));
		page.on('console', (message) => {
			const text = message.text();
			if (message.type() === 'error' && !EXPECTED_ERRORS.some((pattern) => pattern.test(text))) {
				this.errors.push(`${label}: ${text}`);
			}
		});
		return { context, page };
	}

	async register(username: string, options?: BrowserContextOptions) {
		const device = await this.open(username, options);
		await device.page.goto(url('/register'));
		await device.page.fill('#username', username);
		await device.page.fill('#password', PASSWORD);
		await device.page.click('button[type=submit]');
		await device.page.waitForURL(url('/'));
		return device;
	}

	/**
	 * Logs in on a new device.
	 *
	 * @param beforeLoad Runs before the app is loaded, e.g. to change the clock.
	 */
	async login(username: string, beforeLoad?: (page: Page) => Promise<void>) {
		const device = await this.open(`${username} (other device)`);
		await beforeLoad?.(device.page);
		await device.page.goto(url('/login'));
		await logIn(device.page, username);
		return device;
	}

	async close() {
		await Promise.all(this.#contexts.map((context) => context.close()));
	}
}

export const test = base.extend<{ app: Devices }>({
	app: async ({ browser }, use) => {
		const devices = new Devices(browser);
		await use(devices);
		await devices.close();
		expect(devices.errors, 'errors in the browser').toEqual([]);
	}
});

/** Fills in and submits the login form. */
export async function logIn(page: Page, username: string, password = PASSWORD) {
	await page.fill('#username', username);
	await page.fill('#password', password);
	await page.click('button[type=submit]');
	await page.waitForURL(url('/'));
}

export const note = (page: Page, text: string) => page.locator('[data-note-id]', { hasText: text });

export const openedNote = (page: Page) => page.locator('.isFocused');

export async function expectGone(page: Page, text: string) {
	await expect(note(page, text)).toHaveCount(0);
}

export async function newNote(page: Page, text: string) {
	await page.getByRole('button', { name: /new note/i }).click();
	await page.locator('.isFocused .ProseMirror').waitFor();
	// The editor focuses itself once the note has moved into place.
	await page.waitForTimeout(400);
	await page.keyboard.type(text);
	await closeNote(page);
}

export async function openNote(page: Page, text: string) {
	await note(page, text).click();
	await page.locator('.isFocused .ProseMirror').waitFor();
	await page.waitForTimeout(400);
}

/** Closes the open note. Escape closes an open popover first, so it may take more than once. */
export async function closeNote(page: Page) {
	for (let i = 0; i < 3 && (await openedNote(page).count()) > 0; i++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
	}
	await expect(openedNote(page)).toHaveCount(0);
}

/** Adds text at the end of a note. */
export async function appendToNote(page: Page, text: string, appended: string) {
	await openNote(page, text);
	await page.locator('.isFocused .ProseMirror').click();
	await page.keyboard.press('Control+End');
	await page.keyboard.type(appended);
	await page.waitForTimeout(300);
	await closeNote(page);
}

/** Clicks one of the buttons of an open note, e.g. "Archive", by its label. */
export async function clickNoteButton(page: Page, label: string) {
	await page.locator(`.isFocused button[aria-label="${label}"]`).click();
}

/** Opens a note, clicks one of its buttons, and waits until the note leaves the view. */
export async function noteAction(page: Page, text: string, label: string) {
	await openNote(page, text);
	await clickNoteButton(page, label);
	await expectGone(page, text);
}

export async function addTag(page: Page, text: string, tag: string) {
	await openNote(page, text);
	await clickNoteButton(page, 'Tags');
	await page.fill('#tagOptions input[aria-label="Tag name"]', tag);
	await page.keyboard.press('Enter');
	await expect(page.locator('#tagOptions label', { hasText: tag }).locator('input')).toBeChecked();
	await closeNote(page);
}

export const navLink = (page: Page, text: string) =>
	page.locator('nav[aria-label=Notes] a', { hasText: text });

export async function goTo(page: Page, section: 'Notes' | 'Archive' | 'Trash' | (string & {})) {
	await navLink(page, section).click();
}

/** Moves a note to the trash, deletes it forever from there, and goes back to all notes. */
export async function deleteForever(page: Page, text: string) {
	await noteAction(page, text, 'Move to trash');
	await goTo(page, 'Trash');
	await openNote(page, text);
	await openedNote(page)
		.getByRole('button', { name: /Delete forever|Remove from my notes/ })
		.click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: /Delete forever|Remove/ })
		.click();
	await expectGone(page, text);
	await goTo(page, 'Notes');
	await page.waitForURL(url('/'));
}

export const syncStatus = (page: Page) => page.locator('button.syncStatus');

export async function waitSynced(page: Page) {
	await expect(syncStatus(page)).toHaveText(/^\s*Synced\s*$/);
}

/** Syncs right away, by clicking the sync status, and waits until it's done. */
export async function syncNow(page: Page) {
	// Let the delayed sync of recent changes start first.
	await page.waitForTimeout(1200);
	await syncStatus(page).click();
	await waitSynced(page);
}

/** Opens the share popover of a note. */
export async function openSharing(page: Page, text: string) {
	await openNote(page, text);
	await clickNoteButton(page, 'Share');
	await page.locator('#shareOptions:popover-open').waitFor();
}

/** Shares the note whose share popover is open. */
export async function share(page: Page, username: string, permission: 'view' | 'edit') {
	await page.fill('#shareOptions input[aria-label=Username]', username);
	await page.selectOption('#shareOptions select[aria-label=Permission]', permission);
	await page.click('#shareOptions button[type=submit]');
}

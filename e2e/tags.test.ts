import type { Page } from '@playwright/test';
import { addTag, expect, newNote, note, syncNow, test, uniqueName } from './helpers';

const dialog = (page: Page) => page.locator('dialog[open]');
const navTags = (page: Page) => page.locator('nav [aria-labelledby=tagsHeading] a .name');
const tagsOf = (page: Page, text: string) => note(page, text).locator('.tag');
const inputValues = (inputs: Element[]) => inputs.map((input) => (input as HTMLInputElement).value);

async function openTagsDialog(page: Page) {
	await page.getByRole('button', { name: 'Edit tags' }).click();
	await expect(dialog(page)).toBeVisible();
}

async function save(page: Page) {
	await dialog(page).getByRole('button', { name: 'Save' }).click();
	await expect(dialog(page)).toHaveCount(0);
}

test('tags can be renamed, merged, deleted and reordered, on saving', async ({ app }) => {
	const username = uniqueName('tags');
	const { page } = await app.register(username);
	for (const [text, tag] of [
		['Pasta', 'recipe'],
		['Soup', 'recipes'],
		['Plan', 'work'],
		['Garden', 'home'],
		['Ideas list', 'ideas']
	]) {
		await newNote(page, text);
		await addTag(page, text, tag);
	}
	await expect(navTags(page)).toHaveText(['home', 'ideas', 'recipe', 'recipes', 'work']);

	await test.step('cancelling leaves everything as it was', async () => {
		await openTagsDialog(page);
		await dialog(page).getByRole('textbox', { name: 'Name of work' }).fill('Job');
		await dialog(page).getByRole('button', { name: 'Delete home' }).click();
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);
		await expect(navTags(page)).toHaveText(['home', 'ideas', 'recipe', 'recipes', 'work']);

		await openTagsDialog(page);
		await expect(dialog(page).getByRole('textbox', { name: 'Name of work' })).toHaveValue('work');
		await expect(dialog(page).getByRole('textbox', { name: 'Name of home' })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	await test.step('a tag can be merged into another one', async () => {
		await openTagsDialog(page);
		await dialog(page).getByRole('combobox', { name: 'Merge recipe into' }).selectOption('recipes');
		await expect(dialog(page)).toContainText('Merges with “recipes”.');
		await save(page);
		await expect(tagsOf(page, 'Pasta')).toHaveText(['recipes']);
		await expect(navTags(page)).toHaveText(['home', 'ideas', 'recipes', 'work']);
	});

	await test.step('giving a tag the name of another one merges them', async () => {
		await openTagsDialog(page);
		await dialog(page).getByRole('textbox', { name: 'Name of home' }).fill('WORK');
		await expect(dialog(page)).toContainText('Merges with “work”.');
		await save(page);
		await expect(tagsOf(page, 'Garden')).toHaveText(['work']);
		await expect(navTags(page)).toHaveText(['ideas', 'recipes', 'work']);
	});

	await test.step('names that can’t be used aren’t saved', async () => {
		await openTagsDialog(page);
		await dialog(page).getByRole('textbox', { name: 'Name of ideas' }).fill(' ');
		await dialog(page).getByRole('button', { name: 'Save' }).click();
		await expect(dialog(page)).toContainText('Enter a name for the tag.');
		await page.keyboard.press('Escape');
	});

	await test.step('tags can be reordered with the keyboard and by dragging', async () => {
		await openTagsDialog(page);
		await dialog(page).getByRole('button', { name: 'Move work' }).focus();
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await expect(dialog(page).getByRole('button', { name: 'Move work' })).toBeFocused();

		// Measure where the rows are once they're done moving.
		await dialog(page)
			.locator('li')
			.evaluateAll((items) =>
				Promise.all(items.flatMap((item) => item.getAnimations().map((a) => a.finished)))
			);
		const handle = dialog(page).getByRole('button', { name: 'Move ideas' });
		const target = dialog(page).getByRole('button', { name: 'Move recipes' });
		const from = (await handle.boundingBox())!;
		const to = (await target.boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height, { steps: 5 });
		await page.mouse.up();
		await expect
			.poll(() => dialog(page).getByRole('textbox').evaluateAll(inputValues))
			.toEqual(['work', 'recipes', 'ideas']);
		await save(page);
		await expect(navTags(page)).toHaveText(['work', 'recipes', 'ideas']);
	});

	await test.step('new tags come after the ordered ones', async () => {
		await addTag(page, 'Plan', 'another');
		await expect(navTags(page)).toHaveText(['work', 'recipes', 'ideas', 'another']);
		await expect(tagsOf(page, 'Plan')).toHaveText(['work', 'another']);
	});

	await test.step('the order syncs to other devices, and stays after reloading', async () => {
		await syncNow(page);
		const other = await app.login(username);
		await expect(navTags(other.page)).toHaveText(['work', 'recipes', 'ideas', 'another']);

		await openTagsDialog(other.page);
		await dialog(other.page).getByRole('button', { name: 'Move another' }).focus();
		await other.page.keyboard.press('Home');
		await save(other.page);
		await syncNow(other.page);

		await syncNow(page);
		await expect(navTags(page)).toHaveText(['another', 'work', 'recipes', 'ideas']);
		await page.reload();
		await expect(navTags(page)).toHaveText(['another', 'work', 'recipes', 'ideas']);
	});
});

import { clickNoteButton, expect, newNote, openNote, test, uniqueName } from './helpers';

for (const viewport of [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'phone', width: 390, height: 800 }
]) {
	test(`note popovers open above their button on ${viewport.name}`, async ({ app }) => {
		const { page } = await app.register(uniqueName('popover'));
		await page.setViewportSize(viewport);
		await newNote(page, 'Anchored');
		await openNote(page, 'Anchored');

		for (const [label, id] of [
			['Share', 'shareOptions'],
			['Pick color', 'colorSelection'],
			['Tags', 'tagOptions']
		]) {
			await test.step(label, async () => {
				await clickNoteButton(page, label);
				const popover = page.locator(`#${id}`);
				await expect(popover).toBeVisible();

				const button = (await page.locator(`.isFocused [popovertarget="${id}"]`).boundingBox())!;
				const box = (await popover.boundingBox())!;
				// Just above the button, and overlapping it horizontally.
				expect(box.y + box.height).toBeLessThanOrEqual(button.y);
				expect(box.y + box.height).toBeGreaterThan(button.y - 20);
				expect(box.x).toBeLessThan(button.x + button.width);
				expect(box.x + box.width).toBeGreaterThan(button.x);

				await page.keyboard.press('Escape');
				await expect(popover).toBeHidden();
			});
		}
	});
}

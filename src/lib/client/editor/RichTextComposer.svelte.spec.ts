import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Harness from './RichTextComposerHarness.svelte';

const NOTE = '<h1>Shopping</h1><p>Milk</p>';

async function renderComposer(props: Partial<Parameters<typeof Harness>[1]> = {}) {
	const result = await render(Harness, { initialContent: NOTE, ...props });
	const editor = () => result.container.querySelector<HTMLElement>('.ProseMirror')!;
	await expect.poll(() => editor()).toBeTruthy();
	return { ...result, editor, editorLocator: () => page.elementLocator(editor()) };
}

const focusState = () => document.querySelector('output')?.textContent;

describe('RichTextComposer', () => {
	it('shows the note', async () => {
		const { editor } = await renderComposer();
		expect(editor().innerHTML).toContain('<h1>Shopping</h1><p>Milk</p>');
	});

	it('can only be edited, and tabbed to, while it isn’t disabled or read-only', async () => {
		const { editor, rerender, container } = await renderComposer({ disabled: true });
		expect(editor().contentEditable).toBe('false');
		expect(editor().hasAttribute('tabindex')).toBe(false);
		// The note's styles for a closed note go by this class.
		expect(container.querySelector('.isDisabled')).not.toBeNull();

		await rerender({ disabled: false });
		await expect.poll(() => editor().contentEditable).toBe('true');
		expect(editor().getAttribute('tabindex')).toBe('0');
		expect(container.querySelector('.isDisabled')).toBeNull();

		await rerender({ readonly: true });
		await expect.poll(() => editor().contentEditable).toBe('false');
		expect(editor().hasAttribute('tabindex')).toBe(false);
	});

	it('focuses itself once it can be edited, if it should be focused', async () => {
		const { editor, rerender } = await renderComposer({ disabled: true, focused: true });
		expect(document.activeElement).not.toBe(editor());

		await rerender({ disabled: false });
		await expect.poll(() => document.activeElement).toBe(editor());
		await expect.poll(focusState).toBe('focused');
	});

	it('focuses itself when it opens editable, and can be closed while focused', async () => {
		const { editor, unmount } = await renderComposer({ focused: true });
		await expect.poll(() => document.activeElement).toBe(editor());
		// Removing it blurs it in the middle of the update, which must not change state then.
		await unmount();
		expect(document.querySelector('.ProseMirror')).toBeNull();
	});

	it('doesn’t focus itself without autofocus, or when it shouldn’t be focused', async () => {
		const first = await renderComposer({ focused: true, autofocus: false });
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(document.activeElement).not.toBe(first.editor());
		await first.unmount();

		const second = await renderComposer({ focused: false });
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(document.activeElement).not.toBe(second.editor());
	});

	it('tells whether focus is in it', async () => {
		const { editorLocator } = await renderComposer();
		await expect.poll(focusState).toBe('not focused');

		await editorLocator().click();
		await expect.poll(focusState).toBe('focused');

		// And doesn't take focus back when something else is focused, like the share dialog.
		await page.getByRole('textbox', { name: 'Elsewhere' }).click();
		await expect.poll(focusState).toBe('not focused');
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Elsewhere');
	});

	it('reports the HTML on every change, and not before', async () => {
		const onUpdateData = vi.fn();
		const { editorLocator } = await renderComposer({ onUpdateData });
		expect(onUpdateData).not.toHaveBeenCalled();

		await editorLocator().click();
		await userEvent.keyboard('{Control>}{End}{/Control} and eggs');
		await expect
			.poll(() => onUpdateData.mock.lastCall?.[0])
			.toBe('<h1>Shopping</h1><p>Milk and eggs</p>');
	});

	it('turns Markdown shortcuts into checklists and code blocks', async () => {
		const onUpdateData = vi.fn();
		const { editorLocator } = await renderComposer({ initialContent: '<p></p>', onUpdateData });
		await editorLocator().click();

		await userEvent.keyboard('[[ ] Milk{Enter}{Enter}```');
		await userEvent.keyboard(' let a{Enter}');
		await expect
			.poll(() => onUpdateData.mock.lastCall?.[0])
			.toBe(
				'<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Milk</p></div></li></ul>' +
					'<pre><code class="language-plaintext">let a\n</code></pre>' +
					// There's always an empty line at the end to type in.
					'<p></p>'
			);
	});
});

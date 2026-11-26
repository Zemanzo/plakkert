import { describe, expect, it } from 'vitest';
import { renderNotePreview } from './NotePreview';

const render = (html: string) => {
	const element = document.createElement('div');
	element.append(renderNotePreview(html));
	return element;
};

describe('renderNotePreview', () => {
	it('shows headings, text, formatting and checklists like the editor does', () => {
		const element = render(
			'<h1>Groceries</h1><p>Get <strong>these</strong> <em>today</em></p>' +
				'<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Apples</p></li>' +
				'<li data-type="taskItem" data-checked="false"><p>Pears</p></li></ul>'
		);

		expect(element.querySelector('h1')?.textContent).toBe('Groceries');
		expect(element.querySelector('p strong')?.textContent).toBe('these');
		expect(element.querySelector('li[data-checked="true"] p')?.textContent).toBe('Apples');
		const checkboxes = element.querySelectorAll('input[type="checkbox"]');
		expect([...checkboxes].map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
		// Not something to tab through while the note is closed.
		expect([...checkboxes].every((box) => (box as HTMLInputElement).tabIndex === -1)).toBe(true);
	});

	it('leaves out anything the editor wouldn’t accept, such as scripts', () => {
		const element = render(
			'<h1 onclick="alert(1)">Title</h1><script>window.ran = true</script>' +
				'<p><img src="data:," onerror="window.ran = true">Text</p>' +
				'<iframe src="https://example.com"></iframe>' +
				'<p><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>'
		);

		expect(element.querySelector('script, iframe, [onclick], [onerror]')).toBeNull();
		expect(element.querySelector('a[href^="javascript"]')).toBeNull();
		expect(element.querySelector('a[href="https://example.com"]')?.textContent).toBe('good');
		expect((window as { ran?: boolean }).ran).toBeUndefined();
	});

	it('shows no images, from the web or embedded', () => {
		const element = render(
			'<p>Before <img src="https://example.com/a.png" alt="Remote"> after</p>' +
				'<img src="data:image/png;base64,iVBORw0KGgo=">'
		);

		expect(element.querySelector('img')).toBeNull();
		expect(element.textContent).toBe('Before after');
	});

	it('keeps blank lines as high as in the editor, without a placeholder', () => {
		const element = render('<h1></h1><p>One</p><p></p><p>Two</p><pre><code></code></pre>');
		document.body.append(element);
		try {
			const [heading, one, blank] = element.querySelectorAll('h1, p');
			expect(heading.getBoundingClientRect().height).toBeGreaterThan(0);
			expect(blank.getBoundingClientRect().height).toBe(one.getBoundingClientRect().height);
			expect(element.querySelector('pre')!.getBoundingClientRect().height).toBeGreaterThan(0);
			// Lines with text are left as they are.
			expect(one.innerHTML).toBe('One');
			expect(element.querySelector('[data-placeholder], .is-empty')).toBeNull();
		} finally {
			element.remove();
		}
	});
});

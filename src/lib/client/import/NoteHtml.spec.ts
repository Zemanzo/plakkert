import { describe, expect, it } from 'vitest';
import { noteHtml } from './NoteHtml';

describe('noteHtml', () => {
	it('starts with the title, and makes every line a paragraph', () => {
		expect(noteHtml({ title: 'Recipe', text: 'Line one\n\nLine two' })).toBe(
			'<h1>Recipe</h1><p>Line one</p><p></p><p>Line two</p>'
		);
	});

	it('leaves out the heading when there is no title', () => {
		expect(noteHtml({ text: 'Just text' })).toBe('<p>Just text</p>');
		expect(noteHtml({})).toBe('<p></p>');
	});

	it('leaves out blank lines at the start and end', () => {
		expect(noteHtml({ text: '\n \nText\r\n\n' })).toBe('<p>Text</p>');
	});

	it('makes a checklist of the items, without empty ones', () => {
		expect(
			noteHtml({
				title: 'Groceries',
				items: [
					{ text: 'Apples ', checked: true },
					{ text: '', checked: false },
					{ text: 'Pears', checked: false }
				]
			})
		).toBe(
			'<h1>Groceries</h1><ul data-type="taskList">' +
				'<li data-type="taskItem" data-checked="true"><p>Apples</p></li>' +
				'<li data-type="taskItem" data-checked="false"><p>Pears</p></li></ul>'
		);
	});

	it('escapes text, so it is never read as HTML', () => {
		expect(noteHtml({ title: '<b>Hi</b>', text: 'a & b <script>' })).toBe(
			'<h1>&lt;b&gt;Hi&lt;/b&gt;</h1><p>a &amp; b &lt;script&gt;</p>'
		);
	});
});

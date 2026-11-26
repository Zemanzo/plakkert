import { describe, expect, it } from 'vitest';
import { htmlToFormat } from './TextAndMarkdown';

// In the browser, since it reads the HTML with the browser's DOMParser.

const NOTE =
	'<h1>Groceries</h1>' +
	'<p>Get <strong>these</strong> <em>today</em>, <s>not</s> <code>later</code>: ' +
	'<a href="https://example.com">shop</a><br>Second line</p>' +
	'<ul><li><p>Bread</p><ul><li><p>Brown</p></li></ul></li></ul>' +
	'<ol><li><p>First</p></li><li><p>Second</p></li></ol>' +
	'<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Apples</p></li>' +
	'<li data-type="taskItem" data-checked="false"><p>Pears</p></li></ul>' +
	'<blockquote><p>Quoted</p></blockquote>' +
	'<pre><code class="language-js">let a = 1;</code></pre>' +
	'<hr><p></p><p>End</p>';

describe('htmlToFormat', () => {
	it('writes Markdown', () => {
		expect(htmlToFormat(NOTE, 'markdown')).toBe(
			'# Groceries\n\n' +
				'Get **these** *today*, ~~not~~ `later`: [shop](https://example.com)  \nSecond line\n\n' +
				'- Bread\n  - Brown\n\n' +
				'1. First\n2. Second\n\n' +
				'- [x] Apples\n- [ ] Pears\n\n' +
				'> Quoted\n\n' +
				'```js\nlet a = 1;\n```\n\n' +
				'---\n\nEnd\n'
		);
	});

	it('writes plain text', () => {
		expect(htmlToFormat(NOTE, 'text')).toBe(
			'Groceries\n' +
				'Get these today, not later: shop\nSecond line\n' +
				'- Bread\n  - Brown\n' +
				'1. First\n2. Second\n' +
				'- [x] Apples\n- [ ] Pears\n' +
				'> Quoted\n' +
				'let a = 1;\n' +
				'---\n\nEnd\n'
		);
	});

	it('leaves HTML as it is', () => {
		expect(htmlToFormat(NOTE, 'html')).toBe(NOTE);
	});
});

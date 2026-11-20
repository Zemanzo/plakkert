import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './notes';

describe('notes as Markdown', () => {
	it('converts what the editor writes', () => {
		expect(
			htmlToMarkdown(
				'<h1>Groceries</h1><p>For <strong>Sunday</strong></p>' +
					'<ul data-type="taskList">' +
					'<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>Milk</p></div></li>' +
					'<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Eggs</p></div></li>' +
					'</ul><pre><code class="language-js">let a = 1;</code></pre>'
			)
		).toBe('# Groceries\n\nFor **Sunday**\n\n- [x] Milk\n- [ ] Eggs\n\n```js\nlet a = 1;\n```');
	});

	it('leaves out scripts', () => {
		expect(htmlToMarkdown('<p>Hi</p><script>alert(1)</script>')).toBe('Hi');
	});
});

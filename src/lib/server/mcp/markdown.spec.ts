import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown';
import { htmlToMarkdown } from './notes';

describe('markdownToHtml', () => {
	it('makes a paragraph of every line, like the editor', () => {
		expect(markdownToHtml('First line\nSecond line\n\nAfter a blank line')).toBe(
			'<p>First line</p><p>Second line</p><p>After a blank line</p>'
		);
		expect(markdownToHtml('')).toBe('<p></p>');
		expect(markdownToHtml('\n  \n')).toBe('<p></p>');
	});

	it('has headings, rules, quotes and code blocks', () => {
		expect(markdownToHtml('# Title\n### Smaller ###')).toBe('<h1>Title</h1><h3>Smaller</h3>');
		expect(markdownToHtml('Above\n\n---\n\nBelow')).toBe('<p>Above</p><hr><p>Below</p>');
		expect(markdownToHtml('> Quoted\n> **twice**')).toBe(
			'<blockquote><p>Quoted</p><p><strong>twice</strong></p></blockquote>'
		);
		expect(markdownToHtml('```js\nconst a = 1 < 2;\n\n**not bold**\n```')).toBe(
			'<pre><code class="language-js">const a = 1 &lt; 2;\n\n**not bold**</code></pre>'
		);
	});

	it('has lists, checklists and nested lists, without mixing checklists with others', () => {
		expect(markdownToHtml('- One\n- Two\n  - Nested')).toBe(
			'<ul><li><p>One</p></li><li><p>Two</p><ul><li><p>Nested</p></li></ul></li></ul>'
		);
		expect(markdownToHtml('3. Three\n4. Four')).toBe(
			'<ol start="3"><li><p>Three</p></li><li><p>Four</p></li></ol>'
		);
		expect(markdownToHtml('- [ ] Milk\n- [x] Eggs\n- Not a task')).toBe(
			'<ul data-type="taskList">' +
				'<li data-type="taskItem" data-checked="false"><p>Milk</p></li>' +
				'<li data-type="taskItem" data-checked="true"><p>Eggs</p></li></ul>' +
				'<ul><li><p>Not a task</p></li></ul>'
		);
		expect(markdownToHtml('- [ ]')).toBe(
			'<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>'
		);
	});

	it('formats text within lines', () => {
		expect(markdownToHtml('**bold**, *italic*, _also_, ~~gone~~ and `a * b`')).toBe(
			'<p><strong>bold</strong>, <em>italic</em>, <em>also</em>, <s>gone</s> and <code>a * b</code></p>'
		);
		expect(markdownToHtml('snake_case_name and 2 * 3 * 4')).toBe(
			'<p>snake_case_name and 2 * 3 * 4</p>'
		);
		expect(markdownToHtml('\\*not italic\\* and \\# not a heading')).toBe(
			'<p>*not italic* and # not a heading</p>'
		);
	});

	it('only links to the web and e-mail, also for images, which notes don’t have', () => {
		expect(markdownToHtml('[Site](https://example.com/?a=1&b=2)')).toBe(
			'<p><a href="https://example.com/?a=1&amp;b=2">Site</a></p>'
		);
		expect(markdownToHtml('[Mail](mailto:a@example.com)')).toContain('href="mailto:a@example.com"');
		expect(markdownToHtml('[Click](javascript:alert(1))')).not.toContain('<a');
		expect(markdownToHtml('![A cat](https://example.com/cat.png)')).toBe(
			'<p><a href="https://example.com/cat.png">A cat</a></p>'
		);
		expect(markdownToHtml('![](https://example.com/a_b_c.png)')).toBe(
			'<p><a href="https://example.com/a_b_c.png">https://example.com/a_b_c.png</a></p>'
		);
		expect(markdownToHtml('![x](data:image/png;base64,AAAA)')).toBe(
			'<p>![x](data:image/png;base64,AAAA)</p>'
		);
	});

	it('keeps URLs as they are, whatever formatting characters they have', () => {
		expect(markdownToHtml('[init](https://github.com/x/y/blob/main/__init__.py)')).toBe(
			'<p><a href="https://github.com/x/y/blob/main/__init__.py">init</a></p>'
		);
		expect(markdownToHtml('[a](https://a.com/*b*/~~c~~/_d_) and *e*')).toBe(
			'<p><a href="https://a.com/*b*/~~c~~/_d_">a</a> and <em>e</em></p>'
		);
		expect(
			markdownToHtml('[**bold** `code`](https://a.com/__x__) **[link](https://b.com/)**')
		).toBe(
			'<p><a href="https://a.com/__x__"><strong>bold</strong> <code>code</code></a> ' +
				'<strong><a href="https://b.com/">link</a></strong></p>'
		);
	});

	it('never lets HTML through', () => {
		const html = markdownToHtml(
			'<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[x](https://a.com/"onmouseover="alert(1))'
		);
		expect(html).not.toMatch(/<script|<img|"onmouseover/);
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('notes read and written back', () => {
	const roundTrip = (markdown: string) => htmlToMarkdown(markdownToHtml(markdown));

	it('stay the same', () => {
		for (const markdown of [
			'# Groceries\n\n- [ ] Milk\n- [x] Eggs',
			'Some **bold** and _italic_ text\n\nA second line',
			// As get_note shows lists: the editor puts a paragraph in every item.
			'1.  First\n    \n2.  Second',
			'-   Bullet\n    \n    -   Nested',
			'> A quote',
			'```\ncode\n```',
			'Price: 5 \\* 3 \\[not a link\\]'
		]) {
			expect(roundTrip(markdown)).toBe(markdown);
		}
	});

	it('keep what get_note shows of the editor’s own HTML', () => {
		const editorHtml =
			'<h1>Plan</h1><p>Text with <strong>bold</strong></p>' +
			'<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>';
		const markdown = htmlToMarkdown(editorHtml);
		expect(roundTrip(markdown)).toBe(markdown);
	});
});

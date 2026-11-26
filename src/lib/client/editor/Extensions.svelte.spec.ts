import { afterEach, describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import { extensions } from './Extensions';

// Notes are stored as the editor's HTML, so what the editor accepts and writes must stay the
// same: otherwise notes change when opened, and other devices' versions look like edits.

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const edit = (content: string) => (editor = new Editor({ extensions, content }));

describe('the editor', () => {
	it('has the same nodes and marks', () => {
		const schema = getSchema(extensions);
		expect(Object.keys(schema.nodes).sort()).toEqual([
			'blockquote',
			'bulletList',
			'codeBlock',
			'doc',
			'hardBreak',
			'heading',
			'horizontalRule',
			'listItem',
			'orderedList',
			'paragraph',
			'taskItem',
			'taskList',
			'text'
		]);
		expect(Object.keys(schema.marks).sort()).toEqual([
			'bold',
			'code',
			'italic',
			'link',
			'strike',
			'underline'
		]);
	});

	it('writes notes the same way, without images', () => {
		const html = edit(
			'<h1>Title</h1><h2>Second</h2><h3>Third</h3>' +
				'<p>Plain <strong>bold</strong> <em>italic</em> <s>struck</s> <u>under</u> ' +
				'<code>code</code> <a href="https://example.com">link</a><br>next line</p>' +
				'<ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li></ul>' +
				'<ol start="3"><li><p>Three</p></li></ol>' +
				'<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p>' +
				'<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Sub</p></li></ul>' +
				'</li></ul>' +
				'<blockquote><p>Quote</p></blockquote>' +
				'<pre><code class="language-js">let a = 1;</code></pre>' +
				'<pre><code>plain</code></pre>' +
				'<hr>' +
				'<p>Image: <img src="https://example.com/a.png" alt="Remote"></p>' +
				'<img src="data:image/png;base64,iVBORw0KGgo=">' +
				'<p><span style="color: red">styled</span><script>window.ran = true</script></p>'
		).getHTML();

		expect(html).toBe(
			'<h1>Title</h1><h2>Second</h2><h3>Third</h3>' +
				'<p>Plain <strong>bold</strong> <em>italic</em> <s>struck</s> <u>under</u> ' +
				'<code>code</code> <a target="_blank" rel="noopener noreferrer" href="https://example.com">link</a><br>next line</p>' +
				'<ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li></ul>' +
				'<ol start="3"><li><p>Three</p></li></ol>' +
				'<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p>' +
				'<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Sub</p></div></li></ul>' +
				'</div></li></ul>' +
				'<blockquote><p>Quote</p></blockquote>' +
				'<pre><code class="language-js">let a = 1;</code></pre>' +
				'<pre><code class="language-plaintext">plain</code></pre>' +
				'<hr>' +
				// No images, from the web or embedded: they'd load from wherever the author pointed them.
				'<p>Image:</p>' +
				'<p>styled</p>'
		);
		expect((window as { ran?: boolean }).ran).toBeUndefined();
	});

	it('reads what it wrote back the same', () => {
		const first = edit(
			'<h1>Shopping</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
				'<p>Milk</p></li></ul><pre><code>x</code></pre><p><a href="https://example.com">a</a></p>'
		).getHTML();
		editor!.destroy();
		expect(edit(first).getHTML()).toBe(first);
	});

	it('shows a placeholder in empty lines', () => {
		const element = edit('<h1></h1><p></p>').view.dom;
		const empty = [...element.querySelectorAll('.is-empty')];
		expect(empty.map((node) => [node.nodeName, node.getAttribute('data-placeholder')])).toEqual([
			['H1', 'Write something …']
		]);
	});
});

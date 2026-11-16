import { getSchema } from '@tiptap/core';
import { DOMParser as SchemaParser, DOMSerializer, type Schema } from '@tiptap/pm/model';
import { extensions } from './Extensions';

let schema: Schema | undefined;

/**
 * Turns a note's HTML into the DOM the editor would show, without creating an
 * editor, which is much cheaper for the notes that aren't open.
 *
 * The HTML is parsed in an inert document, where nothing runs or loads, and
 * then read through the editor's schema. So only what the editor itself
 * accepts comes through, which matters for notes shared by someone else.
 */
export function renderNotePreview(html: string): DocumentFragment | HTMLElement {
	schema ??= getSchema(extensions);
	const inert = new DOMParser().parseFromString(html, 'text/html');
	const doc = SchemaParser.fromSchema(schema).parse(inert.body);
	const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document });

	// An empty line would have no height, so blank lines would disappear. The editor puts a line
	// break in them, so do the same. There's no placeholder: that's only shown while editing.
	for (const line of fragment.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre > code')) {
		if (line.hasChildNodes()) continue;
		const lineBreak = document.createElement('br');
		lineBreak.className = 'ProseMirror-trailingBreak';
		line.append(lineBreak);
	}
	// Checkboxes are only for show until the note is opened, and shouldn't be tabbed through.
	for (const input of fragment.querySelectorAll('input')) input.tabIndex = -1;
	return fragment;
}

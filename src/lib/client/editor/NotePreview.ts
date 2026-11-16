import { getSchema } from '@tiptap/core';
import { DOMParser as SchemaParser, DOMSerializer, type Schema } from '@tiptap/pm/model';
import { extensions } from './Extensions';

/** Tiptap's default placeholder, which the editor shows in an empty first line. */
const PLACEHOLDER = 'Write something …';

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

	// Like in the editor, where the cursor starts in the first line.
	const first = fragment.firstElementChild;
	if (first && doc.firstChild && !doc.firstChild.isLeaf && doc.firstChild.content.size === 0) {
		first.classList.add('is-empty');
		if (doc.childCount === 1) first.classList.add('is-editor-empty');
		first.setAttribute('data-placeholder', PLACEHOLDER);
	}
	// Checkboxes are only for show until the note is opened, and shouldn't be tabbed through.
	for (const input of fragment.querySelectorAll('input')) input.tabIndex = -1;
	return fragment;
}

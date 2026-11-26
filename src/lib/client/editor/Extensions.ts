import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TaskItemDragHandle } from './TaskItemDragHandle';

// What notes can contain. Notes are stored as the editor's HTML, and previews, exports and the MCP
// server all read them through this schema, so changing it changes existing notes: see
// Extensions.svelte.spec.ts. There are no images: they'd load from wherever the note's author
// pointed them, also for the people it's shared with.
export const extensions = [
	StarterKit.configure({
		// Code blocks without a language still get a class, as notes have always had.
		codeBlock: { defaultLanguage: 'plaintext' },
		link: {
			openOnClick: false,
			HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' }
		}
	}),
	Placeholder.configure({ showOnlyWhenEditable: false }),
	TaskList,
	// By default each checkbox gets a visually hidden label with the item's text, which TaskItem
	// rewrites on every keystroke. That text sits in front of the caret, so Android keyboards see the
	// text before the caret change behind their back and stop composing words: no underline, no
	// backspacing a whole word. A label that doesn't change while typing avoids that.
	TaskItem.configure({
		nested: true,
		a11y: { checkboxLabel: () => 'Checklist item' }
	}),
	TaskItemDragHandle
];

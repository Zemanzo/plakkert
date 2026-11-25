import { defaultExtensions } from '@friendofsvelte/tipex';
import { TaskItem } from '@tiptap/extension-list';
import { TaskItemDragHandle } from './TaskItemDragHandle';

// By default each checkbox gets a visually hidden label with the item's text, which TaskItem rewrites
// on every keystroke. That text sits in front of the caret, so Android keyboards see the text before
// the caret change behind their back and stop composing words: no underline, no backspacing a whole
// word. A label that doesn't change while typing avoids that.
const taskItem = TaskItem.configure({
	nested: true,
	a11y: { checkboxLabel: () => 'Checklist item' }
});

export const extensions = [
	...defaultExtensions.map((extension) => (extension.name === 'taskItem' ? taskItem : extension)),
	TaskItemDragHandle
];

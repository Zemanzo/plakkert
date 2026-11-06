<script lang="ts">
	import { Tipex, type TipexEditor, defaultExtensions } from '@friendofsvelte/tipex';
	import { TaskItemDragHandle } from './TaskItemDragHandle';

	// If Tipex doesn't already ship task lists, add TaskList / TaskItem here too
	// (@tiptap/extension-task-list, @tiptap/extension-task-item with { nested: true }).
	const extensions = [...defaultExtensions, TaskItemDragHandle];
	import { onMount, untrack } from 'svelte';

	let editor = $state<TipexEditor>();
	let {
		disabled,
		readonly = false,
		focused = $bindable(false),
		autofocus = true,
		initialContent = `<h1></h1>
	<p></p>`,
		onUpdateData
	}: {
		initialContent: string;
		/** Whether to focus the editor once it can be edited, if `focused` is set. */
		autofocus?: boolean;
		/** Not interactive, e.g. while the note isn't opened. It can still be scrolled. */
		disabled: boolean;
		/** Can be read and selected, but not edited. */
		readonly?: boolean;
		focused?: boolean;
		onUpdateData?: (htmlContent: string) => void;
	} = $props();

	onMount(() => {
		if (editor) {
			editor.$doc.element.contentEditable = 'false';
			editor.$doc.element.removeAttribute('tabindex');
		}
	});

	let wasEditable = false;

	$effect(() => {
		if (editor) {
			const isEditable = !disabled && !readonly;
			if (isEditable) {
				editor.$doc.element.contentEditable = 'true';
				editor.$doc.element.setAttribute('tabindex', '0');
				// Only focus the editor when it becomes editable (i.e. the note was opened). Tipex
				// updates `focused` on every focus change in the document, so reacting to it would
				// pull focus back from other inputs in the note, like the share dialog.
				if (!wasEditable && autofocus && untrack(() => focused)) {
					editor.$doc.element.focus();
				}
			} else {
				editor.$doc.element.contentEditable = 'false';
				editor.$doc.element.removeAttribute('tabindex');
			}
			wasEditable = isEditable;
		}
	});
</script>

<!-- Tipex writes these bindings from editor events, which can fire in the middle of an update:
     removing a focused editor from the page blurs it. Svelte doesn't allow changing state at that
     point, so the writes are untracked. -->
<Tipex
	body={initialContent}
	bind:focused={() => focused, (value) => untrack(() => (focused = value))}
	bind:tipex={
		() => editor,
		(value) => {
			// It's set again on every transaction, but it's always the same editor.
			if (value !== editor) untrack(() => (editor = value));
		}
	}
	{extensions}
	class={`${disabled ? 'isDisabled' : ''} w-full flex-1`}
	controlComponent={null}
	autofocus={false}
	onupdate={() => onUpdateData?.(editor?.getHTML() ?? '')}
/>

<style>
	:global(.task-drag-handle) {
		position: absolute;
		left: -1.6rem;
		top: 0.2em;
		display: flex;
		align-items: center;
		padding: 2px;
		border-radius: 4px;
		opacity: 0.7;
		cursor: grab;
		user-select: none;
		touch-action: none; /* required so touch drags aren't hijacked by scrolling */
		transition: opacity 120ms;
	}
	:global(li[data-type='taskItem']:hover > .task-drag-handle),
	:global(li[data-type='taskItem']:hover > div > .task-drag-handle),
	:global(.task-dragging .task-drag-handle) {
		opacity: 0.7;
	}
	@media (hover: none) {
		:global(.task-drag-handle) {
			opacity: 0.5;
		}
	}

	/* Hide handles when the note is disabled/readonly (you toggle contentEditable yourself) */
	:global(.ProseMirror[contenteditable='false'] .task-drag-handle) {
		display: none;
	}

	:global(.task-sorting:not(.task-dragging)) {
		transition: transform 150ms ease;
	}
	:global(.task-dragging) {
		position: relative;
		z-index: 10;
		outline: 2px solid #000;
		padding-left: 4px;
		border-radius: 6px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
		cursor: grabbing;
	}
</style>

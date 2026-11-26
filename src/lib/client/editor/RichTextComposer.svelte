<script lang="ts">
	import { Editor } from '@tiptap/core';
	import { untrack } from 'svelte';
	import { extensions } from './Extensions';

	let editor = $state.raw<Editor>();
	let root = $state<HTMLDivElement>();
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

	/** Creates the editor in `element`, once: later changes to `initialContent` are its own. */
	function createEditor(element: HTMLElement) {
		const created = new Editor({
			element,
			extensions,
			content: untrack(() => initialContent),
			autofocus: false,
			onUpdate: () => onUpdateData?.(created.getHTML())
		});
		editor = created;
		return () => {
			editor = undefined;
			created.destroy();
		};
	}

	// Focus changes can come in the middle of an update: removing a focused editor from the page
	// blurs it. Svelte doesn't allow changing state at that point, so the write is untracked.
	function onFocusChange() {
		const hasFocus = !!root?.contains(document.activeElement);
		untrack(() => (focused = hasFocus));
	}

	let wasEditable = false;

	$effect(() => {
		if (editor) {
			const element = editor.view.dom;
			const isEditable = !disabled && !readonly;
			if (isEditable) {
				element.contentEditable = 'true';
				element.setAttribute('tabindex', '0');
				// Only focus the editor when it becomes editable (i.e. the note was opened). `focused`
				// changes on every focus change in the document, so reacting to it would pull focus
				// back from other inputs in the note, like the share dialog.
				if (!wasEditable && autofocus && untrack(() => focused)) {
					element.focus();
				}
			} else {
				element.contentEditable = 'false';
				element.removeAttribute('tabindex');
			}
			wasEditable = isEditable;
		}
	});
</script>

<svelte:document onfocusin={onFocusChange} onfocusout={onFocusChange} />

<!-- NotePreview.svelte has the same structure and classes, so a note doesn't move when opened. -->
<div class="editor {disabled ? 'isDisabled' : ''} w-full flex-1" bind:this={root}>
	<div class="editor-wrap">
		<div class="editor-section" {@attach createEditor}></div>
	</div>
</div>

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

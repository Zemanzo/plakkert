<script lang="ts">
	import { Tipex, type TipexEditor } from '@friendofsvelte/tipex';
	import { onMount, untrack } from 'svelte';

	let editor = $state<TipexEditor>();
	let {
		disabled,
		readonly = false,
		focused = $bindable(false),
		initialContent = `<h1></h1>
	<p></p>`,
		onUpdateData
	}: {
		initialContent: string;
		/** Not interactive at all, e.g. while the note isn't opened. */
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
				if (!wasEditable && untrack(() => focused)) {
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

<Tipex
	body={initialContent}
	bind:focused
	bind:tipex={editor}
	class={`${disabled ? 'pointer-events-none' : ''} w-full flex-1`}
	controlComponent={null}
	autofocus={false}
	onupdate={() => onUpdateData?.(editor?.getHTML() ?? '')}
/>

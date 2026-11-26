<script lang="ts">
	// For RichTextComposer.svelte.spec.ts: shows what the editor binds to `focused`, and has
	// something else to focus.
	import RichTextComposer from './RichTextComposer.svelte';

	let {
		disabled = false,
		readonly = false,
		autofocus = true,
		focused = false,
		initialContent,
		onUpdateData
	}: {
		disabled?: boolean;
		readonly?: boolean;
		autofocus?: boolean;
		focused?: boolean;
		initialContent: string;
		onUpdateData?: (html: string) => void;
	} = $props();

	// The editor writes to it, so it is state of its own, starting from the prop.
	// svelte-ignore state_referenced_locally
	let isFocused = $state(focused);
</script>

<input aria-label="Elsewhere" />
<RichTextComposer
	{disabled}
	{readonly}
	{autofocus}
	{initialContent}
	{onUpdateData}
	bind:focused={isFocused}
/>
<output>{isFocused ? 'focused' : 'not focused'}</output>

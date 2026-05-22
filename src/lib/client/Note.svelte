<script lang="ts">
	import RichTextComposer from './editor/RichTextComposer.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let composer = $state<any>();
	let { id, focusedNoteId = $bindable() }: { id: string; focusedNoteId: string | null } = $props();
	let isFocused = $derived(focusedNoteId === id);
	let isInBackground = $derived(focusedNoteId !== null && focusedNoteId !== id);
	let translateX = $state(0);
	let translateY = $state(0);
	let element: HTMLDivElement | null;

	$effect(() => {
		if (isFocused && composer) {
			composer.getEditor().setEditable(true);
			centerOnScreen();
		} else if (composer) {
			composer.getEditor().setEditable(false);
		}
	});

	const centerOnScreen = () => {
		if (!element) {
			return;
		}
		const rect = element.getBoundingClientRect();
		translateX = window.innerWidth * 0.5 - (rect.left + rect.width * 0.5);
		translateY = window.innerHeight * 0.5 - (rect.top + rect.height * 0.5);
		console.log(`Translating note ${id} by (${translateX}, ${translateY})`);
	};

	const onClick = () => {
		if (focusedNoteId === null) {
			focusedNoteId = id;
		}
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (!isFocused && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onClick();
		}
		if (isFocused && e.key === 'Escape') {
			focusedNoteId = null;
		}
	};

	/**
	 * TODO:
	 * - Only allow one note to be editable at a time
	 * - Make note grow to the middle of the screen in a modal-like fashion when clicked
	 */
</script>

<div
	bind:this={element}
	role="button"
	tabindex="0"
	onclick={onClick}
	onkeydown={onKeyDown}
	data-note-id={id}
	class:isFocused
	class:isInBackground
	style="--translate-x:{translateX}px; --translate-y:{translateY}px;"
>
	<RichTextComposer bind:composer />
</div>

<style>
	div[role='button'] {
		appearance: none;
		border: none;
		text-align: left;
		cursor: pointer;

		min-width: 350px;
		max-width: 500px;
		background: var(--color-yellow);
		border-radius: var(--radius-sm);

		transition: all 0.2s ease;

		&:focus {
			outline: 2px solid var(--color-blue-light);
			outline-offset: 2px;
		}

		&.isFocused {
			transform: translate(var(--translate-x), var(--translate-y));
			z-index: 1000;
			max-width: 70ch;
			width: 90vw;
		}

		&.isInBackground {
			pointer-events: none;
		}
	}
</style>

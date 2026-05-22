<script lang="ts">
	import RichTextComposer from './editor/RichTextComposer.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let composer = $state<any>();
	let { id, focusedNoteId = $bindable() }: { id: string; focusedNoteId: string | null } = $props();
	let isFocused = $derived(focusedNoteId === id);
	let isInBackground = $derived(focusedNoteId !== null && focusedNoteId !== id);

	let element = $state<HTMLDivElement | null>(null);
	let placeholder = $state<HTMLDivElement | null>(null);

	// FLIP animation state
	let isFloating = $state(false);
	let floatLeft = $state(0);
	let floatTop = $state(0);
	let floatWidth = $state(0);
	let floatHeight = $state(0);
	let placeholderHeight = $state(0);

	$effect(() => {
		if (isFocused && composer) {
			composer.getEditor().setEditable(true);
			focus();
		} else if (composer) {
			composer.getEditor().setEditable(false);
			unfocus();
		}
	});

	const focusedWidth = () => Math.min(window.innerWidth * 0.9, 70 * 16);
	const focusedHeight = 400;

	const focus = () => {
		if (!element) return;

		const rect = element.getBoundingClientRect();
		placeholderHeight = rect.height;

		// Phase 1: pin element at its current viewport position (no visual jump)
		floatLeft = rect.left;
		floatTop = rect.top;
		floatWidth = rect.width;
		floatHeight = rect.height;
		isFloating = true;
		focusedNoteId = id;

		// Phase 2: after two frames (ensures phase 1 is painted), animate to center
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const w = focusedWidth();
				floatLeft = (window.innerWidth - w) / 2;
				floatTop = (window.innerHeight - focusedHeight) / 2;
				floatWidth = w;
				floatHeight = focusedHeight;
			});
		});
	};

	const unfocus = () => {
		if (!element || !placeholder) return;

		const rect = placeholder.getBoundingClientRect();

		// Animate back to where the placeholder currently sits in the viewport
		floatLeft = rect.left;
		floatTop = rect.top;
		floatWidth = rect.width;
		floatHeight = placeholderHeight;
		focusedNoteId = null;

		// Restore normal flow once the transition finishes
		element.addEventListener(
			'transitionend',
			() => {
				isFloating = false;
			},
			{ once: true }
		);
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
</script>

{#if isFloating}
	<div bind:this={placeholder} class="placeholder" style="height: {placeholderHeight}px"></div>
{/if}
<div
	bind:this={element}
	role="button"
	tabindex="0"
	onclick={onClick}
	onkeydown={onKeyDown}
	data-note-id={id}
	class:isFloating
	class:isFocused
	class:isInBackground
	style="--float-left:{floatLeft}px; --float-top:{floatTop}px; --float-width:{floatWidth}px; --float-height:{floatHeight}px;"
>
	<RichTextComposer bind:composer isToolbarVisible={isFocused} />
</div>

<style>
	.placeholder {
		min-width: 350px;
		max-width: 500px;
		background: #0003;
		border-radius: var(--radius-sm);
	}

	div[role='button'] {
		appearance: none;
		border: none;
		text-align: left;
		cursor: pointer;

		min-width: 350px;
		max-width: 500px;
		height: 250px;
		background: var(--color-yellow);
		border-radius: var(--radius-sm);

		outline: 2px solid transparent;
		outline-offset: 2px;

		&:focus {
			outline-color: var(--color-blue-light);
		}

		&.isFloating {
			position: fixed;
			left: var(--float-left);
			top: var(--float-top);
			width: var(--float-width);
			height: var(--float-height);
			z-index: 1000;
			transition:
				left 0.2s ease,
				top 0.2s ease,
				width 0.2s ease,
				height 0.2s ease;
		}

		&.isFocused {
			cursor: default;
		}

		&.isInBackground {
			pointer-events: none;
		}
	}
</style>

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
	let floatLeft = $state('0');
	let floatTop = $state('0');
	let floatWidth = $state('0');
	let floatHeight = $state('0');
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

	const focus = () => {
		if (!element) return;

		const rect = element.getBoundingClientRect();
		placeholderHeight = rect.height;

		// Phase 1: pin element at its current viewport position (no visual jump)
		floatLeft = rect.left + 'px';
		floatTop = rect.top + 'px';
		floatWidth = rect.width + 'px';
		floatHeight = rect.height + 'px';
		isFloating = true;

		// Phase 2: after two frames (ensures phase 1 is painted), animate to center
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				floatLeft = '0';
				floatTop = '0';
				floatWidth = '100vw';
				floatHeight = '100vh';
			});
		});
	};

	const unfocus = () => {
		if (!element || !placeholder) return;

		const rect = placeholder.getBoundingClientRect();

		// Restore normal flow once the transition finishes
		element.addEventListener(
			'transitionend',
			() => {
				if (isFocused) return; // If the note was re-focused before the transition ended, keep it floating
				isFloating = false;
			},
			{ once: true }
		);

		// Animate back to where the placeholder currently sits in the viewport
		floatLeft = rect.left + 'px';
		floatTop = rect.top + 'px';
		floatWidth = rect.width + 'px';
		floatHeight = rect.height + 'px';
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
	};

	const onContainerClick = (e: MouseEvent) => {
		if (e.target === element) {
			focusedNoteId = null;
		}
	};
</script>

{#if isFloating}
	<div bind:this={placeholder} class="placeholder" style="height: {placeholderHeight}px"></div>
{/if}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={element}
	class="container"
	class:isFloating
	style="--float-left:{floatLeft}; --float-top:{floatTop}; --float-width:{floatWidth}; --float-height:{floatHeight};"
	onclick={onContainerClick}
>
	<div
		role="button"
		tabindex="0"
		onclick={onClick}
		onkeydown={onKeyDown}
		data-note-id={id}
		class:isFocused
		class:isInBackground
	>
		<RichTextComposer bind:composer isToolbarVisible={isFocused} />
	</div>
</div>

<style>
	.placeholder {
		min-width: 350px;
		max-width: 500px;
		background: #0003;
		border-radius: var(--radius-sm);
	}

	.container {
		min-width: 350px;
		max-width: 500px;
		height: 250px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			left 0.2s ease,
			top 0.2s ease,
			min-width 0.2s ease,
			height 0.2s ease;

		&.isFloating {
			position: absolute;
			left: var(--float-left);
			top: var(--float-top);
			min-width: var(--float-width, 100vw);
			height: var(--float-height, 100vh);
			z-index: 1000;
		}
	}

	div[role='button'] {
		appearance: none;
		border: none;
		text-align: left;
		cursor: pointer;

		width: 100%;
		max-width: 100%;
		height: 100%;
		background: var(--color-yellow);
		border-radius: var(--radius-sm);

		outline: 2px solid transparent;
		outline-offset: 2px;

		transition:
			width 0.2s ease,
			max-width 0.2s ease,
			height 0.2s ease;

		&:focus {
			outline-color: var(--color-blue-light);
		}

		&.isFocused {
			cursor: default;
			width: 70%;
			max-width: 80ch;
			height: 80%;
		}

		&.isInBackground {
			pointer-events: none;
		}
	}

	.container.isFloating div[role='button'] {
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
	}
</style>

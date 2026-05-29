<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { db, type Note } from './Database';
	import RichTextComposer from './editor/RichTextComposer.svelte';
	import { decryptNoteKey, encryptNote } from './serialization/Serialize';
	import { type RuntimeUser } from '$lib/types';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let {
		id,
		content,
		focusedNoteId = $bindable()
	}: { id: Note['id']; focusedNoteId: string | null; content: string } = $props();
	const isFocused = $derived(focusedNoteId === id);
	const isInBackground = $derived(focusedNoteId !== null && focusedNoteId !== id);
	const user = getContext<() => RuntimeUser>('user')();

	let decryptedNoteKey = $state<Uint8Array | null>(null);

	let containerElement = $state<HTMLDivElement | null>(null);
	let placeholder = $state<HTMLDivElement | null>(null);

	// FLIP animation state
	let isFloating = $state(false);
	let floatLeft = $state('0');
	let floatTop = $state('0');
	let floatWidth = $state('0');
	let floatHeight = $state('0');
	let placeholderHeight = $state(0);

	$effect(() => {
		if (isFocused) {
			focus();
		} else {
			unfocus();
		}
	});

	onMount(async () => {
		const noteKeyEntry = await db.noteKeys.where({ noteId: id, userId: user.id }).first();
		if (noteKeyEntry) {
			decryptedNoteKey = await decryptNoteKey(
				noteKeyEntry.encryptedKey,
				user.publicKeyUint8,
				user.decodedPrivateKey!
			);
		} else {
			console.warn(`No note key found for note ${id} and user ${user.id}`);
		}
	});

	const focus = () => {
		if (!containerElement) return;

		const rect = containerElement.getBoundingClientRect();
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
		if (!containerElement || !placeholder) return;

		const rect = placeholder.getBoundingClientRect();

		function onTransitionEnd(event: TransitionEvent) {
			if (isFocused || event.target !== containerElement) return; // If the note was re-focused before the transition ended, keep it floating
			isFloating = false;

			containerElement!.removeEventListener('transitionend', onTransitionEnd);
		}

		// Restore normal flow once the transition finishes
		containerElement.addEventListener('transitionend', onTransitionEnd);

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
		if (e.target === containerElement) {
			focusedNoteId = null;
		}
	};

	const onUpdateData = async (id: string, htmlContent: string) => {
		performance.mark('start');
		const { encryptedData: encryptedNote } = await encryptNote(htmlContent, decryptedNoteKey!);
		db.notes.update(id, { content: encryptedNote });
		performance.mark('end');
		console.log(htmlContent.length, performance.measure('updateNote', 'start', 'end').duration);
	};
</script>

{#if decryptedNoteKey === null}
	<div class="container">Loading...</div>
{:else}
	{#if isFloating}
		<div bind:this={placeholder} class="placeholder" style="height: {placeholderHeight}px"></div>
	{/if}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={containerElement}
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
			<RichTextComposer
				disabled={!isFocused}
				focused={isFocused}
				initialContent={content}
				onUpdateData={(...args) => onUpdateData(id, ...args)}
			/>
		</div>
	</div>
{/if}

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
			left var(--transition-duration) ease,
			top var(--transition-duration) ease,
			min-width var(--transition-duration) ease,
			height var(--transition-duration) ease;

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
		border-radius: var(--radius-md);

		outline: 2px solid transparent;
		outline-offset: 2px;

		transition:
			width var(--transition-duration) linear,
			max-width var(--transition-duration) linear,
			height var(--transition-duration) linear;

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

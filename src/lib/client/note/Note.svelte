<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import type { Note, NoteData, NotePermission } from '../Database';
	import RichTextComposer from '../editor/RichTextComposer.svelte';
	import type { RuntimeUser } from '#lib/types.js';
	import { deleteNote, updateNoteData } from './NotesCRUD';
	import NoteOptions from './NoteOptions.svelte';
	import { leaveNote } from './Sharing';

	let {
		note,
		noteKey,
		permission,
		focusedNoteId = $bindable(),
		onDelete
	}: {
		note: Note;
		/** The decrypted key of this note. */
		noteKey: Uint8Array;
		permission: NotePermission;
		focusedNoteId: string | null;
		onDelete: (noteId: string) => void;
	} = $props();
	const user = getContext<() => RuntimeUser>('user')();
	let { id } = $derived(note);
	const isFocused = $derived(focusedNoteId === id);
	const isInBackground = $derived(focusedNoteId !== null && focusedNoteId !== id);
	const isOwner = $derived(note.ownerId === user.id);
	const canEdit = $derived(permission === 'edit');

	// The note prop is re-read from IndexedDB after every save, so it can lag behind what was just
	// typed. Edits therefore build on the data as last saved here, rather than on the prop.
	let currentData: NoteData = untrack(() => note.data);
	// Versions (updatedAt) saved here that may still come back from IndexedDB. Any other version
	// was written elsewhere, e.g. by sync, and replaces what is shown, even if it's older.
	let ownVersions = [untrack(() => note.updatedAt.getTime())];
	let color = $state(untrack(() => note.data.meta.color));
	let editorContent = $state(untrack(() => note.data.content));
	// Bumped to recreate the editor when the content changed elsewhere.
	let editorRevision = $state(0);

	function save(data: NoteData) {
		currentData = data;
		const updatedAt = new Date();
		ownVersions.push(updatedAt.getTime());
		updateNoteData(id, data, noteKey, updatedAt);
	}

	function changeColor(newColor: string) {
		color = newColor;
		save({ ...currentData, meta: { ...currentData.meta, color: newColor } });
	}

	$effect(() => {
		const { data, updatedAt } = note;
		const version = updatedAt.getTime();
		if (ownVersions.includes(version)) {
			// Once the latest save is stored, earlier ones won't be read back anymore.
			if (version === ownVersions.at(-1)) ownVersions = [version];
			return;
		}
		// Don't replace what is being typed; the effect runs again once the note is closed.
		if (isFocused && canEdit) return;

		ownVersions = [version];
		currentData = data;
		color = data.meta.color;
		if (data.content !== untrack(() => editorContent)) {
			editorContent = data.content;
			editorRevision++;
		}
	});

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

	const deleteCurrentNote = async () => {
		if (isOwner) {
			await deleteNote(id);
		} else {
			await leaveNote(id, user.id);
		}
		onDelete(id);
	};
</script>

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
		style="--bg:var(--color-{color})"
		tabindex="0"
		onclick={onClick}
		onkeydown={onKeyDown}
		data-note-id={id}
		class:isFocused
		class:isInBackground
	>
		{#key editorRevision}
			<RichTextComposer
				disabled={!isFocused}
				readonly={!canEdit}
				focused={isFocused}
				initialContent={editorContent}
				onUpdateData={(htmlContent) => save({ ...currentData, content: htmlContent })}
			/>
		{/key}
		{#if !isOwner}
			<p class="sharedBy">
				Shared by {note.ownerUsername ?? 'someone else'}{canEdit ? '' : ' · view only'}
			</p>
		{/if}
		{#if isFocused}
			<NoteOptions
				noteId={id}
				{noteKey}
				{isOwner}
				{canEdit}
				onDelete={deleteCurrentNote}
				{color}
				onColorChange={changeColor}
			/>
		{/if}
	</div>
</div>

<style>
	.sharedBy {
		margin: 0;
		font-size: 0.8rem;
		color: #1119;
	}

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
		display: flex;
		flex-direction: column;

		padding: var(--spacing-md) var(--spacing-xl);

		width: 100%;
		max-width: 100%;
		height: 100%;
		background: var(--bg, var(--color-yellow));
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

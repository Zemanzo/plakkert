<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import ArrowLeftIcon from '@iconify-svelte/lucide/arrow-left';
	import type { NoteData } from '../Database';
	import RichTextComposer from '../editor/RichTextComposer.svelte';
	import { toasts } from '../components/ToastStore.svelte';
	import {
		daysUntilDeleted,
		isArchived as archived,
		isTrashed as trashed,
		userTags
	} from '../tags/Tags';
	import { updateTags } from '../tags/TagsCRUD';
	import { htmlToText } from '../search/Search';
	import type { RuntimeUser } from '#lib/types.js';
	import {
		archiveNote,
		confirmDeleteForever,
		restoreNote,
		trashNote,
		unarchiveNote
	} from './NoteActions';
	import { updateNoteData } from './NotesCRUD';
	import NoteOptions from './NoteOptions.svelte';
	import type { NoteEntry, NoteStore } from './NoteStore.svelte';

	let {
		entry,
		focusedNoteId = $bindable(),
		onClone
	}: {
		entry: NoteEntry;
		focusedNoteId: string | null;
		onClone: () => void;
	} = $props();
	const user = getContext<() => RuntimeUser>('user')();
	const store = getContext<() => NoteStore>('notes')();
	const note = $derived(entry.note);
	/** The decrypted key of this note. */
	const noteKey = $derived(entry.noteKey);
	let { id } = $derived(note);
	const isFocused = $derived(focusedNoteId === id);
	const isInBackground = $derived(focusedNoteId !== null && focusedNoteId !== id);
	const isOwner = $derived(note.ownerId === user.id);
	const isArchived = $derived(archived(entry.tags));
	const isTrashed = $derived(trashed(entry.tags));
	// Notes in the trash can't be edited, only restored or deleted.
	const canEdit = $derived(entry.permission === 'edit' && !isTrashed);
	const tagNames = $derived(userTags(entry.tags));
	const daysLeft = $derived(daysUntilDeleted(entry.tags));
	const allTags = $derived(store.tags.map((tag) => tag.name));

	const isTouchScreen = matchMedia('(pointer: coarse)').matches;

	/** Matches --transition-duration, which the note uses to move back into the grid. */
	const CLOSE_ANIMATION_MS = 200;

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
	// On a touch screen, focusing the editor brings up the keyboard, which is in the way when
	// reading a note. Only new, empty notes are focused right away there.
	const autofocus = $derived(!isTouchScreen || htmlToText(note.data.content) === '');

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
				// The visible height, which on phones leaves out the browser's toolbars.
				floatHeight = '100dvh';
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

	const onClick = (event: MouseEvent) => {
		// Clicks on the note's own controls bubble up here too. Those may just have closed the note
		// (e.g. archiving it), which must not open it again.
		const fromControl =
			event.target instanceof Element && event.target.closest('button, input, label, [popover]');
		if (!fromControl) openNote();
	};

	function openNote() {
		if (focusedNoteId === null) {
			focusedNoteId = id;
		}
	}

	const onKeyDown = (e: KeyboardEvent) => {
		if (!isFocused && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			openNote();
		}
	};

	const closeNote = () => (focusedNoteId = null);

	const onContainerClick = (e: MouseEvent) => {
		if (e.target === containerElement) closeNote();
	};

	/** Shows what went wrong, e.g. that removing a shared note needs a connection. */
	async function report(action: Promise<unknown>) {
		try {
			await action;
		} catch (error) {
			console.error(error);
			toasts.show(error instanceof Error ? error.message : 'Something went wrong');
		}
	}

	/** Closes the note, then runs an action that takes it out of the current view. */
	async function closeAndRun(action: () => Promise<unknown>) {
		focusedNoteId = null;
		// Let the note move back into the grid first, rather than vanishing from the middle.
		await new Promise((resolve) => setTimeout(resolve, CLOSE_ANIMATION_MS));
		await report(action());
	}

	async function deleteForever() {
		await report(
			confirmDeleteForever(entry, user.id).then((deleted) => {
				if (deleted) focusedNoteId = null;
			})
		);
	}
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
		{#if isFocused}
			<button class="back" aria-label="Back to notes" title="Back" onclick={closeNote}>
				<ArrowLeftIcon width="24px" />
			</button>
		{/if}
		{#key editorRevision}
			<RichTextComposer
				disabled={!isFocused}
				readonly={!canEdit}
				focused={isFocused}
				{autofocus}
				initialContent={editorContent}
				onUpdateData={(htmlContent) => save({ ...currentData, content: htmlContent })}
			/>
		{/key}
		{#if !isOwner || tagNames.length > 0 || daysLeft !== null}
			<div class="details">
				{#if daysLeft !== null}
					<span class="info">
						{daysLeft === 0
							? 'Deleted forever today'
							: `Deleted forever in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
					</span>
				{/if}
				{#if !isOwner}
					<span class="info">
						Shared by {note.ownerUsername ?? 'someone else'}{entry.permission === 'edit'
							? ''
							: ' · view only'}
					</span>
				{/if}
				{#each tagNames as tag (tag)}
					<span class="tag">{tag}</span>
				{/each}
			</div>
		{/if}
		{#if isFocused}
			<NoteOptions
				noteId={id}
				{noteKey}
				{isOwner}
				{canEdit}
				{isArchived}
				{isTrashed}
				tags={entry.tags}
				{allTags}
				{color}
				onColorChange={changeColor}
				onTagsChange={(update) => report(updateTags(id, user.id, noteKey, update))}
				onToggleArchived={() =>
					closeAndRun(() => (isArchived ? unarchiveNote : archiveNote)(entry, user.id))}
				onTrash={() => closeAndRun(() => trashNote(entry, user.id))}
				onRestore={() => closeAndRun(() => restoreNote(entry, user.id))}
				onDeleteForever={deleteForever}
				{onClone}
			/>
		{/if}
	</div>
</div>

<style>
	.details {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm);
		max-height: 3.5rem;
		overflow: hidden;
		padding-block: var(--spacing-sm);
		font-size: 0.8rem;
		color: #1119;

		.info {
			margin-right: var(--spacing-sm);
		}

		.tag {
			padding: var(--spacing-xs) var(--spacing-md);
			border-radius: 999px;
			background: #0000001a;
			color: #111c;
			white-space: nowrap;
			max-width: 12rem;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	.isFocused .details {
		max-height: none;
	}

	.placeholder {
		min-width: min(350px, 100%);
		max-width: 500px;
		background: #0003;
		border-radius: var(--radius-sm);
	}

	.container {
		min-width: min(350px, 100%);
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
			position: fixed;
			left: var(--float-left);
			top: var(--float-top);
			min-width: var(--float-width, 100vw);
			height: var(--float-height, 100dvh);
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
			height var(--transition-duration) linear,
			border-radius var(--transition-duration) linear;

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

	/* Only on narrow screens; elsewhere, clicking next to the note closes it. */
	.back {
		display: none;
		align-self: flex-start;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		margin-left: calc(-1 * var(--spacing-md));
		color: #1119;
		border-radius: 50%;
		cursor: pointer;

		&:hover {
			color: #161616;
			background-color: #00000016;
		}
	}

	@media (max-width: 600px) {
		div[role='button'] {
			padding-inline: var(--spacing-lg);

			/* There's no room around the open note to tap to close it, so it takes the whole screen,
			   with a back button instead. */
			&.isFocused {
				width: 100%;
				height: 100%;
				border-radius: 0;
			}
		}

		.back {
			display: flex;
		}
	}
</style>

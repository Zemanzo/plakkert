<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import ArrowLeftIcon from '@iconify-svelte/lucide/arrow-left';
	import CheckIcon from '@iconify-svelte/lucide/check';
	import EyeOffIcon from '@iconify-svelte/lucide/eye-off';
	import HistoryIcon from '@iconify-svelte/lucide/history';
	import type { NoteData } from '../Database';
	import type { HistoryVersion } from '../history/NoteHistory';
	import NoteHistoryDialog from '../history/NoteHistoryDialog.svelte';
	import { formatEdited, formatFullTime, formatVersionTime } from './EditedTime';
	import NotePreview from '../editor/NotePreview.svelte';
	import RichTextComposer from '../editor/RichTextComposer.svelte';
	import { toasts } from '../components/ToastStore.svelte';
	import {
		daysUntilDeleted,
		HIDDEN_TAG,
		isArchived as archived,
		isHidden as hidden,
		isTrashed as trashed,
		userTags,
		withoutTag,
		withTag
	} from '../tags/Tags';
	import { updateHiddenMessage, updateTags } from '../tags/TagsCRUD';
	import { htmlToText } from '../search/Search';
	import { preferencesOf } from '../settings/Preferences';
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
		selected = false,
		selecting = false,
		onSelect,
		onClone
	}: {
		entry: NoteEntry;
		focusedNoteId: string | null;
		selected?: boolean;
		/** While notes are being selected, clicking a note selects it, rather than opening it. */
		selecting?: boolean;
		/**
		 * Selects or deselects the note. With `range`, selects the notes from the one selected last
		 * up to this one instead.
		 */
		onSelect?: (range: boolean) => void;
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
	const tagNames = $derived(userTags(entry.tags).sort(store.compareTags));
	const daysLeft = $derived(daysUntilDeleted(entry.tags));
	// A hidden note's text is only shown while it's open, e.g. for when someone looks along.
	const isHidden = $derived(hidden(entry.tags));
	const hiddenMessage = $derived(entry.hiddenMessage);
	const showsHidden = $derived(isHidden && !isFocused);
	const hideTags = preferencesOf(user).hideTagsOfHiddenNotes;
	const shownTags = $derived(showsHidden && hideTags ? [] : tagNames);
	const allTags = $derived(store.tags.map((tag) => tag.name));
	const keepsHistory = $derived(store.keepsHistory(note));
	let historyOpen = $state(false);

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

	/** How long to wait for more typing before saving. Every save updates the whole list. */
	const SAVE_DELAY_MS = 300;
	let saveTimeout: ReturnType<typeof setTimeout> | undefined;
	let hasUnsavedChanges = false;

	/** Saves the data shortly, once typing pauses, or right away if `now` is set. */
	function save(data: NoteData, now = false) {
		currentData = data;
		// For the preview once the note is closed. The open editor only reads it when it's created.
		editorContent = data.content;
		hasUnsavedChanges = true;
		clearTimeout(saveTimeout);
		if (now) {
			saveNow();
		} else {
			saveTimeout = setTimeout(saveNow, SAVE_DELAY_MS);
		}
	}

	/** Always after the version saved last, so a save right after another isn't lost to it. */
	const nextUpdatedAt = () => new Date(Math.max(Date.now(), (ownVersions.at(-1) ?? 0) + 1));

	function saveNow() {
		clearTimeout(saveTimeout);
		if (!hasUnsavedChanges) return;
		hasUnsavedChanges = false;
		const updatedAt = nextUpdatedAt();
		ownVersions.push(updatedAt.getTime());
		return updateNoteData(id, currentData, noteKey, { updatedAt, userId: user.id });
	}

	/**
	 * Brings back an earlier version of the note. What it was until now is kept in the history
	 * first, so this can be undone the same way.
	 */
	async function restoreVersion(version: HistoryVersion) {
		await saveNow();
		const updatedAt = nextUpdatedAt();
		ownVersions.push(updatedAt.getTime());
		currentData = version.data;
		color = version.data.meta.color;
		editorContent = version.data.content;
		editorRevision++;
		try {
			await updateNoteData(id, version.data, noteKey, {
				updatedAt,
				userId: user.id,
				keepPrevious: 'always'
			});
			toasts.show(`Restored the version of ${formatVersionTime(version.updatedAt)}.`);
		} catch (error) {
			console.error(error);
			toasts.show('The version couldn’t be restored.');
		}
	}

	// Nothing typed is left unsaved when the note is closed, or the app is left or closed.
	$effect(() => {
		if (!isFocused) return;
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') saveNow();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', saveNow);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', saveNow);
			saveNow();
		};
	});

	function changeColor(newColor: string) {
		color = newColor;
		save({ ...currentData, meta: { ...currentData.meta, color: newColor } }, true);
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
		if (fromControl) return;
		// Ctrl-clicking (⌘ on a Mac) selects a note without opening it, and so does clicking while
		// selecting. Shift-clicking selects the notes from the one selected last up to it.
		if (!isFocused && onSelect && (selectsOnly(event) || selecting)) {
			onSelect(event.shiftKey);
		} else {
			openNote();
		}
	};

	const selectsOnly = (event: MouseEvent | KeyboardEvent) =>
		event.ctrlKey || event.metaKey || event.shiftKey;

	/** Shift-clicking would otherwise select the text from the last click up to here. */
	const onMouseDown = (event: MouseEvent) => {
		if (!isFocused && onSelect && event.shiftKey) event.preventDefault();
	};

	function openNote() {
		if (focusedNoteId === null) {
			focusedNoteId = id;
		}
	}

	const onKeyDown = (e: KeyboardEvent) => {
		if (isFocused || e.target !== e.currentTarget) return;
		if (e.key === ' ' && (selectsOnly(e) || selecting) && onSelect) {
			e.preventDefault();
			onSelect(e.shiftKey);
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (selecting && onSelect) onSelect(e.shiftKey);
			else openNote();
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
		onmousedown={onMouseDown}
		onkeydown={onKeyDown}
		data-note-id={id}
		aria-pressed={selecting && !isFocused ? selected : undefined}
		class:isFocused
		class:isInBackground
		class:selected={selected && !isFocused}
	>
		{#if (selecting || selected) && !isFocused}
			<span class="selectMark" aria-hidden="true">
				{#if selected}<CheckIcon width="16px" />{/if}
			</span>
		{/if}
		{#if isFocused}
			<div class="noteHeader">
				<button class="back" aria-label="Back to notes" title="Back" onclick={closeNote}>
					<ArrowLeftIcon width="24px" />
				</button>
				<span class="edited">
					Edited
					<time datetime={note.updatedAt.toISOString()} title={formatFullTime(note.updatedAt)}>
						{formatEdited(note.updatedAt)}
					</time>
				</span>
				{#if keepsHistory}
					<button
						class="historyButton"
						aria-label="View history"
						title="View history"
						onclick={() => (historyOpen = true)}
					>
						<HistoryIcon width="20px" />
					</button>
					<NoteHistoryDialog
						bind:open={historyOpen}
						noteId={id}
						{noteKey}
						userId={user.id}
						current={{
							data: { content: editorContent, meta: { color } },
							updatedAt: note.updatedAt
						}}
						{canEdit}
						onRestore={restoreVersion}
					/>
				{/if}
			</div>
		{/if}
		<!-- Only the open note gets an editor. With hundreds of notes, editors for all of them would
		     make the app slow. -->
		{#if isFocused}
			{#key editorRevision}
				<RichTextComposer
					disabled={false}
					readonly={!canEdit}
					focused
					{autofocus}
					initialContent={editorContent}
					onUpdateData={(htmlContent) => save({ ...currentData, content: htmlContent })}
				/>
			{/key}
		{:else if showsHidden}
			<div class="hiddenContent">
				<EyeOffIcon width="32px" aria-hidden="true" />
				{#if hiddenMessage}
					<p>{hiddenMessage}</p>
				{:else}
					<span class="sr-only">Hidden note</span>
				{/if}
			</div>
		{:else}
			<NotePreview html={editorContent} />
		{/if}
		{#if !isOwner || shownTags.length > 0 || daysLeft !== null}
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
				{#each shownTags as tag (tag)}
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
				{isHidden}
				{hiddenMessage}
				tags={entry.tags}
				{allTags}
				{color}
				htmlContent={editorContent}
				onColorChange={changeColor}
				onTagsChange={(update) => report(updateTags(id, user.id, noteKey, update))}
				onHiddenChange={(hide) =>
					report(
						updateTags(id, user.id, noteKey, (tags) =>
							hide ? withTag(tags, HIDDEN_TAG) : withoutTag(tags, HIDDEN_TAG)
						)
					)}
				onHiddenMessageChange={(message) =>
					report(updateHiddenMessage(id, user.id, noteKey, message))}
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

	/* In place of the text of a hidden note. */
	.hiddenContent {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		overflow: hidden;
		color: #1119;
		text-align: center;

		p {
			margin: 0;
			font-weight: bold;
			overflow-wrap: anywhere;
		}
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
		/* For the selection mark. */
		position: relative;
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

		&.selected {
			outline: 3px solid var(--color-text-primary);
			/* Inside the note, so the list doesn't cut it off at the top. */
			outline-offset: -3px;
		}
	}

	/* Shows whether a note is selected, while selecting. */
	.selectMark {
		position: absolute;
		top: var(--spacing-sm);
		right: var(--spacing-sm);
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: 2px solid #1118;
		border-radius: 50%;
		background: #fff8;
		color: #fff;

		.selected & {
			border-color: var(--color-text-primary);
			background: var(--color-text-primary);
			color: var(--color-background-header);
		}
	}

	.container.isFloating div[role='button'] {
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
	}

	/* At the top of the open note: when it was edited, and its history. */
	.noteHeader {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--spacing-xs);
		flex-shrink: 0;
		min-height: 40px;
		margin-right: calc(-1 * var(--spacing-md));
		font-size: 0.8rem;
		color: #1119;
	}

	.edited {
		white-space: nowrap;
	}

	.historyButton {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		cursor: pointer;

		&:hover {
			color: #161616;
			background-color: #00000016;
		}
	}

	/* Only on narrow screens; elsewhere, clicking next to the note closes it. */
	.back {
		display: none;
		margin-right: auto;
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

	@media (max-width: 420px) {
		div[role='button'] {
			padding-inline: 0;
			padding: var(--spacing-xs) var(--spacing-sm);
		}
	}
</style>

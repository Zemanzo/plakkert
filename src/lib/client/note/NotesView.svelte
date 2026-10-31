<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import SearchIcon from '@iconify-svelte/lucide/search';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import { parseSearchQuery } from '../search/Search';
	import SyncStatus from '../sync/SyncStatus.svelte';
	import { isTrashed, TRASH_RETENTION_DAYS } from '../tags/Tags';
	import type { RuntimeUser } from '#lib/types.js';
	import { confirmEmptyTrash } from './NoteActions';
	import { createNote } from './NotesCRUD';
	import NotesGrid from './NotesGrid.svelte';
	import type { NoteStore } from './NoteStore.svelte';
	import { selectNotes, type NotesViewKind } from './Views';

	let { view }: { view: NotesViewKind } = $props();

	const user = getContext<() => RuntimeUser>('user')();
	const store = getContext<() => NoteStore>('notes')();

	let focusedNoteId = $state<string | null>(null);
	let hasFocusedNote = $derived(focusedNoteId !== null);
	let searchInput = $state<HTMLInputElement>();

	const viewKey = $derived(view.kind === 'tag' ? `tag:${view.tag}` : view.kind);
	const terms = $derived(parseSearchQuery(store.searchQuery));
	// The open note stays, even if an edit makes it stop matching the search.
	const selection = $derived(
		store.entries && selectNotes(store.entries, view, terms, focusedNoteId)
	);
	const isEmpty = $derived(selection?.main.length === 0 && selection.archived.length === 0);
	// New notes are neither archived nor trashed, so they'd be hidden right away in those views.
	const canCreate = $derived(view.kind === 'notes' || view.kind === 'tag');
	// "Empty trash" empties all of it, not just the notes that match the search.
	const trashedEntries = $derived(
		view.kind === 'trash' ? (store.entries ?? []).filter((entry) => isTrashed(entry.tags)) : []
	);

	const searchPlaceholder = $derived.by(() => {
		switch (view.kind) {
			case 'tag':
				return `Search “${view.tag}”`;
			case 'archive':
				return 'Search the archive';
			case 'trash':
				return 'Search the trash';
			default:
				return 'Search notes';
		}
	});

	$effect(() => {
		// Close the open note when switching to another view.
		void viewKey;
		focusedNoteId = null;
	});

	// Whether the open note has been shown. A new note is opened before it shows up in the list.
	let focusedNoteShown = false;
	$effect(() => {
		if (focusedNoteId === null || !selection) {
			focusedNoteShown = false;
			return;
		}
		const shown = [...selection.main, ...selection.archived].some(
			(entry) => entry.note.id === focusedNoteId
		);
		if (shown) {
			focusedNoteShown = true;
		} else if (focusedNoteShown) {
			// It left this view while open, e.g. it was archived or deleted on another device.
			focusedNoteId = null;
		}
	});

	async function addNote() {
		// A new, empty note wouldn't match the search, and so wouldn't show up.
		store.searchQuery = '';
		// The note shows up through the store, and focuses itself once it does. In a tag's view, it
		// gets that tag.
		focusedNoteId = await createNote(
			user,
			view.kind === 'tag' ? { [view.tag]: Date.now() } : undefined
		);
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

	function onkeydown(event: KeyboardEvent) {
		// Escape closes an open popover or dialog first, e.g. cancelling "Delete forever?" shouldn't
		// close the note as well. Nothing behind a dialog can be focused either.
		if (document.querySelector(':popover-open, dialog[open]')) return;

		if (event.key === 'Escape') {
			if (focusedNoteId !== null) {
				focusedNoteId = null;
			} else if (event.target === searchInput) {
				store.searchQuery = '';
				searchInput?.blur();
			}
		} else if (event.key === '/' && focusedNoteId === null && !isTyping(event.target)) {
			// Like many sites, "/" jumps to the search field.
			event.preventDefault();
			searchInput?.focus();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="notesView" data-view={view.kind}>
	<div class="toolbar">
		<SyncStatus />
		<div class="actions">
			<div class="search">
				<SearchIcon width="18px" aria-hidden="true" />
				<input
					bind:this={searchInput}
					bind:value={store.searchQuery}
					type="search"
					placeholder={searchPlaceholder}
					aria-label={searchPlaceholder}
					aria-keyshortcuts="/"
				/>
				{#if store.searchQuery}
					<button
						class="clear"
						aria-label="Clear search"
						onclick={() => {
							store.searchQuery = '';
							searchInput?.focus();
						}}
					>
						<CloseIcon width="18px" />
					</button>
				{/if}
			</div>
			{#if canCreate}
				<Button onclick={addNote}>+ New note</Button>
			{:else if view.kind === 'trash'}
				<Button
					--bg="var(--color-red)"
					disabled={trashedEntries.length === 0}
					onclick={() => confirmEmptyTrash(trashedEntries, user.id)}
				>
					Empty trash
				</Button>
			{/if}
		</div>
	</div>

	{#if hasFocusedNote}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="modal-background"
			transition:fade={{ duration: 200 }}
			onclick={() => (focusedNoteId = null)}
		></div>
	{/if}

	<div class="scroll-container">
		{#if view.kind === 'archive'}
			<p class="explainer">
				Archived notes stay out of the way of your other notes, but still show up when you search
				them.
			</p>
		{:else if view.kind === 'trash'}
			<p class="explainer">
				Notes in the trash are deleted forever after {TRASH_RETENTION_DAYS} days. Notes you shared stay
				available to others until then.
			</p>
		{/if}

		{#if store.loadError}
			<p class="message">Error loading notes: {store.loadError.message}</p>
		{:else if !selection}
			<p class="message">Loading...</p>
		{:else}
			{#if isEmpty}
				<p class="message">
					{#if terms.length > 0}
						No notes match “{store.searchQuery.trim()}”.
					{:else if view.kind === 'tag'}
						No notes with this tag.
					{:else if view.kind === 'archive'}
						No archived notes.
					{:else if view.kind === 'trash'}
						The trash is empty.
					{:else}
						No notes yet. Click “New note” to create your first note!
					{/if}
				</p>
			{/if}

			<NotesGrid entries={selection.main} bind:focusedNoteId />

			{#if selection.archived.length > 0}
				<h3 class="sectionHeading">Archived</h3>
				<NotesGrid entries={selection.archived} bind:focusedNoteId />
			{/if}

			{#if selection.trashedMatches > 0}
				<p class="hint">
					{selection.trashedMatches === 1
						? '1 matching note'
						: `${selection.trashedMatches} matching notes`} in the
					<a href={resolve('/(notes)/trash')}>trash</a>.
				</p>
			{/if}

			{#if store.failedCount > 0}
				<p class="hint">
					{store.failedCount === 1 ? '1 note' : `${store.failedCount} notes`} could not be decrypted.
				</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.notesView {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;

		/* Comic book style patterns, to tell the archive and the trash apart from the other notes at a
		   glance: halftone dots for the archive, hatching for the trash. */
		&[data-view='archive'] {
			background-image:
				radial-gradient(var(--color-pattern) 2px, transparent 2.5px),
				radial-gradient(var(--color-pattern) 2px, transparent 2.5px);
			background-size: 16px 16px;
			background-position:
				0 0,
				8px 8px;
		}

		&[data-view='trash'] {
			background-image: repeating-linear-gradient(
				-45deg,
				var(--color-pattern) 0 2px,
				transparent 2px 10px
			);
		}
	}

	.toolbar {
		display: flex;
		padding: var(--spacing-lg);
		gap: var(--spacing-md);
		align-items: center;
	}

	.actions {
		display: flex;
		flex: 1;
		min-width: 0;
		gap: var(--spacing-md);
		justify-content: center;
		align-items: center;
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex: 0 1 28rem;
		min-width: 0;
		padding-inline: var(--spacing-md) var(--spacing-sm);
		border-radius: var(--radius-lg);
		background: var(--color-input-background);
		color: var(--color-text-primary);

		&:focus-within {
			outline: 2px solid var(--color-yellow);
		}

		:global(svg) {
			flex-shrink: 0;
			opacity: 0.6;
		}

		input {
			flex: 1;
			min-width: 0;
			padding-inline: 0;
			background: transparent;
			outline: none;

			&::-webkit-search-cancel-button {
				display: none;
			}
		}

		.clear {
			display: flex;
			padding: var(--spacing-sm);
			border-radius: 50%;
			cursor: pointer;

			&:hover {
				background: #8883;
			}
		}
	}

	.scroll-container {
		overflow: auto;
		flex: 1;
		padding: 0 var(--spacing-lg) var(--spacing-lg);
	}

	.explainer {
		margin: 0 0 var(--spacing-lg);
		font-size: 0.8rem;
		opacity: 0.6;
	}

	.message {
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		text-align: center;
	}

	.sectionHeading {
		margin: var(--spacing-xl) 0 var(--spacing-md);
		font-family: var(--font-family-display);
		font-size: 1.2rem;
		font-weight: normal;
		opacity: 0.8;
	}

	.hint {
		margin: var(--spacing-xl) 0 0;
		text-align: center;
		opacity: 0.8;

		a {
			color: inherit;
		}
	}

	.modal-background {
		background: rgba(0, 0, 0, 0.5);
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
	}

	@media (max-width: 600px) {
		.toolbar,
		.actions {
			gap: var(--spacing-sm);
		}

		.toolbar {
			padding: var(--spacing-md);
		}

		.scroll-container {
			padding: 0 var(--spacing-md) var(--spacing-md);
		}
	}
</style>

<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import ArchiveIcon from '@iconify-svelte/lucide/archive';
	import SearchIcon from '@iconify-svelte/lucide/search';
	import TagIcon from '@iconify-svelte/lucide/tag';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import { parseSearchQuery } from '../search/Search';
	import SyncStatus from '../sync/SyncStatus.svelte';
	import { TRASH_RETENTION_DAYS } from '../tags/Tags';
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
	const selection = $derived(store.entries && selectNotes(store.entries, view, terms));
	const isEmpty = $derived(selection?.main.length === 0 && selection.archived.length === 0);
	// New notes are neither archived nor trashed, so they'd be hidden right away in those views.
	const canCreate = $derived(view.kind === 'notes' || view.kind === 'tag');

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

<div class="toolbar">
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
	{/if}
	<SyncStatus />
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
	{#if view.kind !== 'notes'}
		<div class="viewHeader">
			<h2>
				{#if view.kind === 'tag'}
					<TagIcon width="20px" aria-hidden="true" />{view.tag}
				{:else if view.kind === 'archive'}
					<ArchiveIcon width="20px" aria-hidden="true" />Archive
				{:else}
					<TrashIcon width="20px" aria-hidden="true" />Trash
				{/if}
			</h2>
			{#if view.kind === 'trash'}
				<p>
					Notes in the trash are deleted forever after {TRASH_RETENTION_DAYS} days. Notes you shared stay
					available to others until then.
				</p>
				{#if selection && selection.main.length > 0 && terms.length === 0}
					<Button
						class="sm"
						--bg="var(--color-red)"
						onclick={() => confirmEmptyTrash(selection.main, user.id)}
					>
						Empty trash
					</Button>
				{/if}
			{/if}
		</div>
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
					No archived notes. Archive notes to keep them without having them in the way.
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

<style>
	.toolbar {
		display: flex;
		padding: var(--spacing-lg);
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

	.viewHeader {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm) var(--spacing-lg);
		margin-bottom: var(--spacing-lg);

		h2 {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
			margin: 0;
			overflow-wrap: anywhere;
		}

		p {
			flex: 1 1 20rem;
			margin: 0;
			font-size: 0.9rem;
			opacity: 0.8;
		}
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
		.toolbar {
			padding: var(--spacing-md);
			gap: var(--spacing-sm);
		}

		.scroll-container {
			padding: 0 var(--spacing-md) var(--spacing-md);
		}
	}
</style>

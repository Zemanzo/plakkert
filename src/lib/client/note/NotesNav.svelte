<script lang="ts">
	import { getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArchiveIcon from '@iconify-svelte/lucide/archive';
	import PencilIcon from '@iconify-svelte/lucide/pencil';
	import StickyNoteIcon from '@iconify-svelte/lucide/sticky-note';
	import TagIcon from '@iconify-svelte/lucide/tag';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import { tagHref } from '../tags/TagLinks';
	import TagsDialog from '../tags/TagsDialog.svelte';
	import type { NoteStore } from './NoteStore.svelte';

	const store = getContext<() => NoteStore>('notes')();

	let tagsDialog = $state<TagsDialog>();

	const path = $derived(page.url.pathname);
	const currentTag = $derived(path === '/' ? page.url.searchParams.get('tag') : null);
	const current = (active: boolean) => (active ? 'page' : undefined);

	let nav = $state<HTMLElement>();
	$effect(() => {
		// On phones the links scroll sideways, so the current one may be out of view.
		void page.url.href;
		void store.tags;
		nav
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});
</script>

<nav aria-label="Notes" bind:this={nav}>
	<a href={resolve('/(notes)')} aria-current={current(path === '/' && !currentTag)}>
		<StickyNoteIcon width="20px" aria-hidden="true" />
		<span class="name">Notes</span>
	</a>
	<a href={resolve('/(notes)/archive')} aria-current={current(path === '/archive')}>
		<ArchiveIcon width="20px" aria-hidden="true" />
		<span class="name">Archive</span>
	</a>
	<a href={resolve('/(notes)/trash')} aria-current={current(path === '/trash')}>
		<TrashIcon width="20px" aria-hidden="true" />
		<span class="name">Trash</span>
	</a>

	<div class="tags" role="group" aria-labelledby="tagsHeading">
		<h2 id="tagsHeading">Tags</h2>
		{#each store.tags as tag (tag.name)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it -->
			<a href={tagHref(tag.name)} aria-current={current(currentTag === tag.name)}>
				<TagIcon width="20px" aria-hidden="true" />
				<span class="name">{tag.name}</span>
				<span class="count" aria-label={`${tag.count} notes`}>{tag.count}</span>
			</a>
		{:else}
			<p>Tags you add to notes show up here.</p>
		{/each}
		{#if store.tags.length > 0}
			<button onclick={() => tagsDialog?.open()}>
				<PencilIcon width="20px" aria-hidden="true" />
				<span class="name">Edit tags</span>
			</button>
		{/if}
	</div>
</nav>

<TagsDialog bind:this={tagsDialog} />

<style>
	nav {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		flex: 0 0 15rem;
		overflow-y: auto;
		padding: var(--spacing-lg) var(--spacing-md);
		border-right: 1px solid #8883;
	}

	a,
	button {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-lg);
		color: var(--color-text-primary);
		text-decoration: none;
		cursor: pointer;
		opacity: 0.8;

		&:hover {
			background-color: #8882;
			opacity: 1;
		}

		&[aria-current='page'] {
			background-color: color-mix(in srgb, var(--color-yellow) 35%, transparent);
			opacity: 1;
		}

		:global(svg) {
			flex-shrink: 0;
		}
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}

	.count {
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.tags {
		display: contents;

		h2 {
			margin: var(--spacing-lg) var(--spacing-md) var(--spacing-sm);
			font-size: 0.85rem;
			font-family: var(--font-family-default);
			font-weight: bold;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			opacity: 0.6;
		}

		p {
			margin: 0 var(--spacing-md);
			font-size: 0.85rem;
			opacity: 0.6;
		}
	}

	/* On narrow screens, the navigation is a row of chips that scrolls sideways. */
	@media (max-width: 700px) {
		nav {
			flex: none;
			flex-direction: row;
			gap: var(--spacing-sm);
			overflow-x: auto;
			overflow-y: hidden;
			padding: var(--spacing-md) var(--spacing-md) 0;
			border-right: none;
			scrollbar-width: none;
		}

		a,
		button {
			flex-shrink: 0;
			padding: var(--spacing-sm) var(--spacing-lg);
			border-radius: 999px;
			background-color: #8881;
		}

		.name {
			overflow: visible;
		}

		.tags {
			h2,
			p {
				display: none;
			}
		}
	}
</style>

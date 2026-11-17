<script lang="ts">
	import { getContext } from 'svelte';
	import ArchiveIcon from '@iconify-svelte/lucide/archive';
	import ArchiveRestoreIcon from '@iconify-svelte/lucide/archive-restore';
	import EyeIcon from '@iconify-svelte/lucide/eye';
	import EyeOffIcon from '@iconify-svelte/lucide/eye-off';
	import PaletteIcon from '@iconify-svelte/lucide/palette';
	import RestoreIcon from '@iconify-svelte/lucide/rotate-ccw';
	import TagIcon from '@iconify-svelte/lucide/tag';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import { toasts } from '../components/ToastStore.svelte';
	import TagPicker from '../tags/TagPicker.svelte';
	import { isArchived, isHidden, userTags, type NoteTags } from '../tags/Tags';
	import type { RuntimeUser } from '#lib/types.js';
	import ColorPicker from './ColorPicker.svelte';
	import {
		confirmDeleteManyForever,
		setArchived,
		setColor,
		setHidden,
		setTrashed,
		updateTagsOfEntries
	} from './NoteActions';
	import type { NoteEntry, NoteStore } from './NoteStore.svelte';
	import type { NotesViewKind } from './Views';

	let {
		entries,
		view,
		canSelectAll,
		onSelectAll,
		onClose,
		onDone
	}: {
		/** The selected notes. */
		entries: NoteEntry[];
		view: NotesViewKind;
		/** Whether there are notes in the view that aren't selected yet. */
		canSelectAll: boolean;
		onSelectAll: () => void;
		/** Stops selecting. */
		onClose: () => void;
		/** After an action that takes the notes out of the view, e.g. archiving them. */
		onDone: () => void;
	} = $props();

	const user = getContext<() => RuntimeUser>('user')();
	const store = getContext<() => NoteStore>('notes')();

	let busy = $state(false);
	const disabled = $derived(busy || entries.length === 0);
	const count = $derived(`${entries.length} selected`);

	// Tags all of the notes have are checked in the tag picker; tags only some of them have are
	// shown as such.
	const tagCounts = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this computation
		const counts = new Map<string, number>();
		for (const entry of entries) {
			for (const tag of userTags(entry.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return counts;
	});
	const commonTags = $derived(
		Object.fromEntries(
			[...tagCounts].filter(([, count]) => count === entries.length).map(([tag]) => [tag, 0])
		) as NoteTags
	);
	const partialTags = $derived(
		[...tagCounts].filter(([, count]) => count < entries.length).map(([tag]) => tag)
	);

	const editable = $derived(entries.filter((entry) => entry.permission === 'edit'));
	/** The colour of the notes, if they all have the same one. */
	const color = $derived.by(() => {
		const colors = new Set(editable.map((entry) => entry.note.data.meta.color));
		return colors.size === 1 ? [...colors][0] : null;
	});

	// In the archive, notes can only be unarchived; elsewhere, unarchived when all already are.
	const unarchive = $derived(
		view.kind === 'archive' || (entries.length > 0 && entries.every((e) => isArchived(e.tags)))
	);

	// Unhidden when all already are hidden.
	const unhide = $derived(entries.length > 0 && entries.every((e) => isHidden(e.tags)));

	/** Runs an action on the selected notes, and shows what went wrong, if anything. */
	async function run(action: (entries: NoteEntry[]) => Promise<unknown>, done = false) {
		busy = true;
		try {
			// The notes as they are now: the selection changes as notes leave the view.
			await action([...entries]);
			if (done) onDone();
		} catch (error) {
			console.error(error);
			toasts.show(error instanceof Error ? error.message : 'Something went wrong');
		} finally {
			busy = false;
		}
	}
</script>

<!-- One row on wide screens. On narrow screens, two: what is selected, in place of the navigation,
     and the actions, each with its name, scrolling sideways like the navigation when they don't
     fit. -->
<div class="selectionBar" role="toolbar" aria-label="Selected notes">
	<div class="head">
		<button aria-label="Stop selecting" title="Stop selecting (Esc)" onclick={onClose}>
			<CloseIcon width="22px" />
		</button>
		<span class="count" aria-live="polite">{count}</span>
		<button
			class="selectAllButton"
			title={`${canSelectAll ? 'Select' : 'Deselect'} all (Ctrl+A)`}
			aria-keyshortcuts="Control+A Meta+A"
			disabled={busy}
			onclick={onSelectAll}
			>{canSelectAll ? 'Select' : 'Deselect'} all
		</button>
	</div>

	<div class="actions">
		{#if view.kind === 'trash'}
			<button
				aria-label="Restore"
				title="Restore"
				{disabled}
				onclick={() => run((notes) => setTrashed(notes, user.id, false), true)}
			>
				<RestoreIcon width="22px" />
				<span class="label">Restore</span>
			</button>
			<button
				class="danger"
				aria-label="Delete forever"
				title="Delete forever"
				{disabled}
				onclick={() =>
					run(async (notes) => {
						if (await confirmDeleteManyForever(notes, user.id)) onDone();
					})}
			>
				<TrashIcon width="22px" />
				<span class="label">Delete forever</span>
			</button>
		{:else}
			<button popovertarget="selectionTags" aria-label="Tags" title="Tags" {disabled}>
				<TagIcon width="22px" />
				<span class="label">Tags</span>
			</button>
			<button
				popovertarget="selectionColors"
				aria-label="Pick color"
				title="Color"
				disabled={disabled || editable.length === 0}
			>
				<PaletteIcon width="22px" />
				<span class="label">Color</span>
			</button>
			<button
				aria-label={unhide ? 'Unhide' : 'Hide'}
				title={unhide ? 'Unhide' : 'Hide when closed'}
				{disabled}
				onclick={() => run((notes) => setHidden(notes, user.id, !unhide))}
			>
				{#if unhide}
					<EyeIcon width="22px" />
				{:else}
					<EyeOffIcon width="22px" />
				{/if}
				<span class="label">{unhide ? 'Unhide' : 'Hide'}</span>
			</button>
			<button
				aria-label={unarchive ? 'Unarchive' : 'Archive'}
				title={unarchive ? 'Unarchive' : 'Archive'}
				{disabled}
				onclick={() => run((notes) => setArchived(notes, user.id, !unarchive), true)}
			>
				{#if unarchive}
					<ArchiveRestoreIcon width="22px" />
				{:else}
					<ArchiveIcon width="22px" />
				{/if}
				<span class="label">{unarchive ? 'Unarchive' : 'Archive'}</span>
			</button>
			<button
				aria-label="Move to trash"
				title="Move to trash"
				{disabled}
				onclick={() => run((notes) => setTrashed(notes, user.id, true), true)}
			>
				<TrashIcon width="22px" />
				<span class="label">Move to trash</span>
			</button>
		{/if}
	</div>
</div>

{#if view.kind !== 'trash'}
	<div popover id="selectionTags">
		<TagPicker
			tags={commonTags}
			{partialTags}
			allTags={store.tags.map((tag) => tag.name)}
			onChange={(update) => run((notes) => updateTagsOfEntries(notes, user.id, update))}
		/>
	</div>
	<div popover id="selectionColors">
		<ColorPicker
			name="selectionColor"
			{color}
			onChange={(newColor) => run((notes) => setColor(notes, newColor))}
		/>
	</div>
{/if}

<style>
	.selectionBar {
		display: flex;
		flex: 0 1 36rem;
		min-width: 0;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-lg);
		color: var(--color-text-primary);
	}

	.head {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.count {
		flex-shrink: 0;
		margin-inline: var(--spacing-sm);
		font-weight: bold;
		white-space: nowrap;
	}

	.selectAllButton {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		text-decoration: underline;
		color: var(--color-text-muted);

		&:hover {
			background-color: transparent;
			color: var(--color-text-primary);
		}
	}

	.actions {
		display: flex;
		gap: var(--spacing-sm);
		margin-left: auto;
	}

	button {
		display: flex;
		flex-shrink: 0;
		padding: var(--spacing-sm);
		border-radius: 50%;
		cursor: pointer;

		&:hover:not(:disabled) {
			background-color: #8883;
		}

		&:disabled {
			opacity: 0.4;
			cursor: default;
		}

		&.danger {
			color: var(--color-red);
		}
	}

	/* The names of the actions are only shown on narrow screens, see below. */
	.label {
		display: none;
	}

	@media (max-width: 700px) {
		.selectionBar {
			flex: 1;
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			padding: 0;
		}

		/* As high as the navigation's row, whose place it takes. */
		.head {
			height: 40px;
		}

		.selectAllButton {
			margin-left: auto;
		}

		/* Like the navigation's chips, scrolling sideways when they don't all fit. */
		.actions {
			flex: 1;
			align-items: center;
			margin-left: 0;
			overflow-x: auto;
			scrollbar-width: none;

			button {
				align-items: center;
				gap: var(--spacing-sm);
				padding: var(--spacing-sm) var(--spacing-lg);
				border-radius: 999px;
				background-color: #8881;
			}
		}

		.label {
			display: inline;
			white-space: nowrap;
		}
	}

	div[popover] {
		/* Below the button that opens it. */
		position: fixed;
		position-area: bottom span-left;
		margin-top: var(--spacing-sm);
		background: var(--color-background-body);
		color: var(--color-text-primary);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		box-shadow: 0 4px 16px #0004;

		/* Without anchor positioning, show it in the middle of the screen instead of the corner. */
		@supports not (position-area: bottom) {
			margin: auto;
		}
	}
</style>

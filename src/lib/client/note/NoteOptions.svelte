<script lang="ts">
	import ArchiveIcon from '@iconify-svelte/lucide/archive';
	import ArchiveRestoreIcon from '@iconify-svelte/lucide/archive-restore';
	import PaletteIcon from '@iconify-svelte/lucide/palette';
	import ShareIcon from '@iconify-svelte/lucide/share-2';
	import TagIcon from '@iconify-svelte/lucide/tag';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import CopyIcon from '@iconify-svelte/lucide/copy';
	import DownloadIcon from '@iconify-svelte/lucide/download';
	import Button from '../components/Button.svelte';
	import TagPicker from '../tags/TagPicker.svelte';
	import type { NoteTags } from '../tags/Tags';
	import ShareOptions from './ShareOptions.svelte';
	import ExportOptions from './ExportOptions.svelte';
	import { isNoteColor, NOTE_COLORS } from './NoteColors';

	let {
		noteId,
		noteKey,
		isOwner,
		canEdit,
		isArchived,
		isTrashed,
		tags,
		allTags,
		color,
		htmlContent,
		onColorChange,
		onTagsChange,
		onToggleArchived,
		onTrash,
		onRestore,
		onDeleteForever,
		onClone
	}: {
		noteId: string;
		noteKey: Uint8Array;
		isOwner: boolean;
		canEdit: boolean;
		isArchived: boolean;
		isTrashed: boolean;
		tags: NoteTags;
		/** All tags the user has, to pick from. */
		allTags: string[];
		color: string;
		/** The HTML content of the note, used for exporting */
		htmlContent: string;
		onColorChange: (color: string) => void;
		onTagsChange: (update: (tags: NoteTags) => NoteTags) => void;
		onToggleArchived: () => void;
		onTrash: () => void;
		onRestore: () => void;
		/** Deletes the note, or for notes shared with the user, removes it from their notes. */
		onDeleteForever: () => void;
		onClone: () => void;
	} = $props();

	let shareOptions = $state<ShareOptions>();

	function handleColorChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const selectedColor = target.value;

		if (isNoteColor(selectedColor)) {
			onColorChange(selectedColor);
		} else {
			console.warn(`Selected color "${selectedColor}" is not in the allowed colors.`);
		}
	}
</script>

<div class="optionsContainer">
	{#if isTrashed}
		<Button
			class="sm"
			--bg="var(--color-background-body)"
			--text="var(--color-text-primary)"
			onclick={onRestore}
		>
			Restore
		</Button>
		<Button class="sm" --bg="var(--color-red)" onclick={onDeleteForever}>
			{isOwner ? 'Delete forever' : 'Remove from my notes'}
		</Button>
	{:else}
		{#if isOwner}
			<button popovertarget="shareOptions" aria-label="Share" title="Share">
				<ShareIcon width="24px" />
			</button>
		{/if}
		{#if canEdit}
			<button popovertarget="colorSelection" aria-label="Pick color" title="Color">
				<PaletteIcon width="24px" />
			</button>
		{/if}
		<button popovertarget="tagOptions" aria-label="Tags" title="Tags">
			<TagIcon width="24px" />
		</button>
		<button aria-label="Export" title="Export" popovertarget="exportOptions">
			<DownloadIcon width="24px" />
		</button>
		<button aria-label="Clone" title="Clone" onclick={onClone}>
			<CopyIcon width="24px" />
		</button>
		<button
			aria-label={isArchived ? 'Unarchive' : 'Archive'}
			title={isArchived ? 'Unarchive' : 'Archive'}
			onclick={onToggleArchived}
		>
			{#if isArchived}
				<ArchiveRestoreIcon width="24px" />
			{:else}
				<ArchiveIcon width="24px" />
			{/if}
		</button>
		<button aria-label="Move to trash" title="Move to trash" onclick={onTrash}>
			<TrashIcon width="24px" />
		</button>

		{#if isOwner}
			<div
				popover
				id="shareOptions"
				ontoggle={(event) => {
					if (event.newState === 'open') shareOptions?.load();
				}}
			>
				<ShareOptions bind:this={shareOptions} {noteId} {noteKey} />
			</div>
		{/if}

		<div popover id="colorSelection">
			{#each NOTE_COLORS as option (option.id)}
				<input
					type="radio"
					id={`colorSelector-${option.id}`}
					name="colorSelector"
					value={option.id}
					checked={option.id === color}
					onchange={handleColorChange}
				/>
				<label
					for={`colorSelector-${option.id}`}
					style:--swatch={`var(--color-${option.id})`}
					aria-label={option.label}
					title={option.label}
				></label>
			{/each}
		</div>

		<div popover id="tagOptions">
			<TagPicker {tags} {allTags} onChange={onTagsChange} />
		</div>

		<div popover id="exportOptions">
			<ExportOptions {noteId} htmlContent={htmlContent} />
		</div>
	{/if}
</div>

<style>
	.optionsContainer {
		position: relative;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		flex-wrap: wrap;
		min-height: var(--spacing-xxl);
		gap: var(--spacing-md);

		> button {
			height: var(--spacing-xxl);
			padding: 0 var(--spacing-sm);
			color: #1119;
			cursor: pointer;
			border-radius: 50%;

			&:hover {
				color: #161616;
				background-color: #00000016;
			}
		}
	}

	div[popover] {
		/* Fixed like the open note itself: Firefox won't anchor an absolutely positioned popover to
		   a button inside a fixed element. */
		position: fixed;
		position-area: top span-left;
		margin-bottom: var(--spacing-sm);
		background: var(--color-background-body);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);

		&:popover-open {
			display: flex;
		}

		/* Without anchor positioning, show it in the middle of the screen instead of the corner. */
		@supports not (position-area: top) {
			margin: auto;
		}
	}

	#colorSelection {
		padding: var(--spacing-md);
		gap: var(--spacing-md);

		&:popover-open {
			display: grid;
			grid-template-columns: repeat(5, 32px);
		}

		input {
			display: none;
		}

		label {
			position: relative;
			width: 32px;
			height: 32px;
			border-radius: 50%;
			cursor: pointer;
			background-color: var(--swatch);
		}

		input:checked + label {
			outline: 1px solid var(--color-text-primary);

			&::after {
				content: '✔';
				position: absolute;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 0.7rem;
				background: var(--color-background-body);
				width: 16px;
				height: 16px;
				border-radius: 50%;
				bottom: -6px;
				right: -2px;
			}
		}
	}
</style>

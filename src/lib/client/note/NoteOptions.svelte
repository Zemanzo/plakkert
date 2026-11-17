<script lang="ts">
	import ArchiveIcon from '@iconify-svelte/lucide/archive';
	import ArchiveRestoreIcon from '@iconify-svelte/lucide/archive-restore';
	import PaletteIcon from '@iconify-svelte/lucide/palette';
	import ShareIcon from '@iconify-svelte/lucide/share-2';
	import TagIcon from '@iconify-svelte/lucide/tag';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import CopyIcon from '@iconify-svelte/lucide/copy';
	import DownloadIcon from '@iconify-svelte/lucide/download';
	import EyeOffIcon from '@iconify-svelte/lucide/eye-off';
	import Button from '../components/Button.svelte';
	import TagPicker from '../tags/TagPicker.svelte';
	import { MAX_HIDDEN_MESSAGE_LENGTH, type NoteTags } from '../tags/Tags';
	import ShareOptions from './ShareOptions.svelte';
	import ExportOptions from './ExportOptions.svelte';
	import ColorPicker from './ColorPicker.svelte';

	let {
		noteId,
		noteKey,
		isOwner,
		canEdit,
		isArchived,
		isTrashed,
		isHidden,
		hiddenMessage,
		tags,
		allTags,
		color,
		htmlContent,
		onColorChange,
		onTagsChange,
		onHiddenChange,
		onHiddenMessageChange,
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
		/** Whether the note's text is hidden while it's closed. */
		isHidden: boolean;
		/** Shown in place of the text while it's hidden. */
		hiddenMessage: string;
		tags: NoteTags;
		/** All tags the user has, to pick from. */
		allTags: string[];
		color: string;
		/** The HTML content of the note, used for exporting */
		htmlContent: string;
		onColorChange: (color: string) => void;
		onTagsChange: (update: (tags: NoteTags) => NoteTags) => void;
		onHiddenChange: (hidden: boolean) => void;
		onHiddenMessageChange: (message: string) => void;
		onToggleArchived: () => void;
		onTrash: () => void;
		onRestore: () => void;
		/** Deletes the note, or for notes shared with the user, removes it from their notes. */
		onDeleteForever: () => void;
		onClone: () => void;
	} = $props();

	let shareOptions = $state<ShareOptions>();
	let messageInput = $state<HTMLInputElement>();
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
		<button
			popovertarget="hideOptions"
			aria-label="Hide when closed"
			title="Hide when closed"
			class:active={isHidden}
		>
			<EyeOffIcon width="24px" />
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
			<ColorPicker name="colorSelector" {color} onChange={onColorChange} />
		</div>

		<div popover id="tagOptions">
			<TagPicker {tags} {allTags} onChange={onTagsChange} />
		</div>

		<!-- The message is saved when leaving the field, or when closing this without leaving it. -->
		<div
			popover
			id="hideOptions"
			ontoggle={(event) => {
				if (event.newState === 'closed' && isHidden && messageInput) {
					onHiddenMessageChange(messageInput.value);
				}
			}}
		>
			<div class="hideOptions">
				<label class="checkbox">
					<input
						class="plainCheckbox"
						type="checkbox"
						checked={isHidden}
						onchange={(event) => onHiddenChange(event.currentTarget.checked)}
					/>
					Hide when closed
				</label>
				<p class="hint">
					Shows a crossed-out eye instead of the text, until you open the note. Only for you.
				</p>
				<label class="message">
					Message (optional)
					<input
						bind:this={messageInput}
						type="text"
						value={hiddenMessage}
						maxlength={MAX_HIDDEN_MESSAGE_LENGTH}
						placeholder="Shown instead of the text"
						disabled={!isHidden}
						onchange={(event) => onHiddenMessageChange(event.currentTarget.value)}
					/>
				</label>
			</div>
		</div>

		<div popover id="exportOptions">
			<ExportOptions {noteId} {htmlContent} />
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

			&:hover,
			&.active {
				color: #161616;
				background-color: #00000016;
			}
		}
	}

	.hideOptions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: min(18rem, 80vw);
		padding: var(--spacing-sm);
		color: var(--color-text-primary);

		.checkbox {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
			font-weight: bold;
		}

		.hint {
			margin: 0;
			font-size: 0.8rem;
			opacity: 0.7;
		}

		.message {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			font-size: 0.85rem;

			input:disabled {
				opacity: 0.5;
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
</style>

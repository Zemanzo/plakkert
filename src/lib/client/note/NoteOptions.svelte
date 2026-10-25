<script lang="ts">
	import MenuKebabIcon from '@iconify-svelte/charm/menu-kebab';
	import PaletteIcon from '@iconify-svelte/lucide/palette';
	import ShareIcon from '@iconify-svelte/lucide/share-2';
	import Button from '../components/Button.svelte';
	import ShareOptions from './ShareOptions.svelte';

	const COLORS = ['red', 'yellow', 'green', 'blue'];

	let {
		noteId,
		noteKey,
		isOwner,
		canEdit,
		onDelete,
		color,
		onColorChange
	}: {
		noteId: string;
		noteKey: Uint8Array;
		isOwner: boolean;
		canEdit: boolean;
		/** Deletes the note, or for notes shared with the user, removes it from their notes. */
		onDelete: () => Promise<void>;
		color: string;
		onColorChange: (color: string) => void;
	} = $props();

	let shareOptions = $state<ShareOptions>();
	let deleteError = $state<string | null>(null);

	async function handleDelete(event: MouseEvent) {
		event.stopPropagation();
		deleteError = null;
		try {
			await onDelete();
		} catch (error) {
			deleteError = error instanceof Error ? error.message : 'Unexpected error';
		}
	}

	function handleColorChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const selectedColor = target.value;

		if (COLORS.includes(selectedColor)) {
			onColorChange(selectedColor);
		} else {
			console.warn(`Selected color "${selectedColor}" is not in the allowed colors.`);
		}
	}
</script>

<div class="optionsContainer">
	{#if isOwner}
		<button popovertarget="shareOptions" aria-label="Share">
			<ShareIcon width="24px" />
		</button>
	{/if}
	{#if canEdit}
		<button popovertarget="colorSelection" aria-label="Pick color">
			<PaletteIcon width="24px" />
		</button>
	{/if}
	<button popovertarget="moreOptions" aria-label="More options">
		<MenuKebabIcon width="24px" />
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
		{#each COLORS as option (option)}
			<input
				type="radio"
				id={`colorSelector-${option}`}
				name="colorSelector"
				value={option}
				checked={option === color}
				onchange={handleColorChange}
			/>
			<label for={`colorSelector-${option}`} data-color={`--color-${option}`} aria-label={option}
			></label>
		{/each}
	</div>

	<div popover id="moreOptions">
		<Button --bg="var(--color-red)" onclick={handleDelete}>
			{isOwner ? 'Delete' : 'Remove from my notes'}
		</Button>
		{#if deleteError}
			<p class="error">{deleteError}</p>
		{/if}
	</div>
</div>

<style>
	.optionsContainer {
		position: relative;
		display: flex;
		justify-content: flex-end;
		height: var(--spacing-xxl);
		gap: var(--spacing-md);

		button {
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
		position: absolute;
		position-area: top span-left;
		margin-bottom: var(--spacing-sm);
		background: var(--color-background-body);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);

		&:popover-open {
			display: flex;
		}
	}

	#moreOptions {
		flex-direction: column;
		gap: var(--spacing-sm);
		max-width: 20rem;

		.error {
			margin: 0;
			font-size: 0.9rem;
			color: var(--color-red);
		}
	}

	#colorSelection {
		padding: var(--spacing-md);
		gap: var(--spacing-md);

		input {
			display: none;
		}

		label {
			position: relative;
			width: 32px;
			height: 32px;
			border-radius: 50%;
			cursor: pointer;
			background-color: var(--color-red);

			&[data-color='--color-yellow'] {
				background-color: var(--color-yellow);
			}
			&[data-color='--color-green'] {
				background-color: var(--color-green);
			}
			&[data-color='--color-blue'] {
				background-color: var(--color-blue);
			}
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

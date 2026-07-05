<script lang="ts">
	import MenuKebabIcon from '@iconify-svelte/charm/menu-kebab';
	import PaletteIcon from '@iconify-svelte/lucide/palette';
	import Button from '../components/Button.svelte';
	import type { Note } from '../Database';
	import { updateNoteMeta } from './NotesCRUD';

	const COLORS = ['red', 'yellow', 'green', 'blue'];

	let {
		onDelete,
		data
	}: {
		onDelete: (event: MouseEvent) => void;
		data: Omit<Note, 'content'>;
	} = $props();

	function handleColorChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const selectedColor = target.value;

		if (COLORS.includes(selectedColor)) {
			updateNoteMeta(data.id, { color: selectedColor });
		} else {
			console.warn(`Selected color "${selectedColor}" is not in the allowed colors.`);
		}
	}
</script>

<div class="optionsContainer">
	<button popovertarget="colorSelection" aria-label="Pick color">
		<PaletteIcon width="24px" />
	</button>
	<button popovertarget="moreOptions" aria-label="More options">
		<MenuKebabIcon width="24px" />
	</button>

	<div popover id="colorSelection">
		{#each COLORS as color (color)}
			<input
				type="radio"
				id={`colorSelector-${color}`}
				name="colorSelector"
				value={color}
				checked={color === data.meta.color}
				onchange={handleColorChange}
			/>
			<label for={`colorSelector-${color}`} data-color={`--color-${color}`} aria-label={color}
			></label>
		{/each}
	</div>

	<div popover id="moreOptions">
		<Button --bg="var(--color-red)" onclick={onDelete}>Delete</Button>
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

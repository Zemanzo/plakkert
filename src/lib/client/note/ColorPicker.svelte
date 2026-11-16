<script lang="ts">
	import { isNoteColor, NOTE_COLORS } from './NoteColors';

	let {
		name,
		color,
		onChange
	}: {
		/** Tells this group of options apart from others on the page. */
		name: string;
		/** The current colour, if there is one. */
		color: string | null;
		onChange: (color: string) => void;
	} = $props();

	function onchange(event: Event & { currentTarget: HTMLInputElement }) {
		const selected = event.currentTarget.value;
		if (isNoteColor(selected)) {
			onChange(selected);
		} else {
			console.warn(`Selected color "${selected}" is not in the allowed colors.`);
		}
	}
</script>

<div class="colors">
	{#each NOTE_COLORS as option (option.id)}
		<input
			type="radio"
			id={`${name}-${option.id}`}
			{name}
			value={option.id}
			checked={option.id === color}
			{onchange}
		/>
		<label
			for={`${name}-${option.id}`}
			style:--swatch={`var(--color-${option.id})`}
			aria-label={option.label}
			title={option.label}
		></label>
	{/each}
</div>

<style>
	.colors {
		display: grid;
		grid-template-columns: repeat(5, 32px);
		gap: var(--spacing-md);
		padding: var(--spacing-sm);
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
</style>

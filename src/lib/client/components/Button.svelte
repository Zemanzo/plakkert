<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let { children, ...restProps }: HTMLButtonAttributes = $props();
</script>

<button {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</button>

<style lang="scss">
	@import '../../../mixins.scss';

	button {
		--background-color: var(--bg, var(--color-yellow));
		--color: var(--text, var(--color-black));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: var(--spacing-md) var(--spacing-lg);
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		line-height: 1;
		color: var(--color);
		background-color: var(--background-color);
		border-radius: 0.6rem;
		border-bottom: 2px solid;
		@include dark(border-bottom-color, --background-color);
		cursor: pointer;
		user-select: none;
		text-decoration: none;
		white-space: nowrap;
		vertical-align: middle;

		&.sm {
			padding: var(--spacing-sm);
			font-size: 1rem;
		}

		&:hover {
			@include light(background, --background-color);
		}

		&:active {
			@include dark(background, --background-color);
			border-bottom: 0;
			border-top: 2px solid transparent;
			transform: translateY(2px);
		}

		&:disabled {
			filter: grayscale(100%) brightness(80%);
			cursor: not-allowed;
		}
	}
</style>

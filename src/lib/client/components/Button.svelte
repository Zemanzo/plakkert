<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let { children, ...restProps }: HTMLButtonAttributes = $props();
</script>

<button {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	button {
		--btn-hover-filter: brightness(0.94);

		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0 0.4rem;
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		line-height: 1;
		color: var(--color-black);
		background: var(--color-yellow);
		border-radius: 0.6rem;
		cursor: pointer;
		user-select: none;
		text-decoration: none;
		white-space: nowrap;
		vertical-align: middle;
		transition:
			filter 120ms ease,
			transform 120ms ease,
			box-shadow 120ms ease,
			opacity 120ms ease;
	}
</style>

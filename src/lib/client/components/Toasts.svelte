<script lang="ts">
	import { fly } from 'svelte/transition';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import { toasts } from './ToastStore.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast"
			transition:fly={{ y: 20, duration: 150 }}
			onmouseenter={() => toasts.pause(toast.id)}
			onmouseleave={() => toasts.resume(toast.id)}
			onfocusin={() => toasts.pause(toast.id)}
			onfocusout={() => toasts.resume(toast.id)}
			role="presentation"
		>
			<span>{toast.message}</span>
			{#if toast.action}
				{@const action = toast.action}
				<button
					class="action"
					onclick={() => {
						toasts.dismiss(toast.id);
						action.run();
					}}
				>
					{action.label}
				</button>
			{/if}
			<button class="close" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}>
				<CloseIcon width="16px" />
			</button>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		bottom: var(--spacing-xl);
		left: 50%;
		translate: -50% 0;
		z-index: 2000;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		width: max-content;
		max-width: calc(100vw - 2 * var(--spacing-lg));
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-lg);
		border-radius: var(--radius-lg);
		/* Inverted colours, so the toast stands out from the page. (light-dark() can't be used in
		   components: the build rewrites it into variables that the static stylesheet doesn't set.) */
		background: var(--color-text-secondary);
		color: var(--color-background-header);
		box-shadow: 0 4px 16px #0004;
		pointer-events: auto;
	}

	button {
		display: inline-flex;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: inherit;

		&:hover {
			background: #8884;
		}
	}

	.action {
		font-weight: bold;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.close {
		padding: var(--spacing-sm);
		opacity: 0.7;
	}
</style>

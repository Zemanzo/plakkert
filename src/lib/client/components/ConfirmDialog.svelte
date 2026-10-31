<script lang="ts">
	import Button from './Button.svelte';
	import { confirmation } from './Confirmation.svelte';

	let dialog = $state<HTMLDialogElement>();
	const request = $derived(confirmation.request);

	$effect(() => {
		if (!dialog) return;
		if (request && !dialog.open) {
			// Cancelling with Escape leaves the previous value in place.
			dialog.returnValue = '';
			dialog.showModal();
		} else if (!request && dialog.open) {
			dialog.close();
		}
	});
</script>

<!-- Closing with Escape fires "close" too, which counts as cancelling. -->
<dialog
	bind:this={dialog}
	aria-labelledby="confirmTitle"
	onclose={() => confirmation.answer(dialog?.returnValue === 'confirm')}
>
	{#if request}
		<form method="dialog">
			<h2 id="confirmTitle">{request.title}</h2>
			<p>{request.message}</p>
			<div class="buttons">
				<Button
					class="sm"
					--bg="var(--color-input-background)"
					--text="var(--color-text-primary)"
					value="cancel"
				>
					Cancel
				</Button>
				<Button
					class="sm"
					--bg={request.danger ? 'var(--color-red)' : undefined}
					value="confirm"
					autofocus={!request.danger}
				>
					{request.confirmLabel}
				</Button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	dialog {
		/* Tailwind's reset removes the margin that centers dialogs. */
		margin: auto;
		width: min(26rem, calc(100vw - 2 * var(--spacing-lg)));
		padding: var(--spacing-xl);
		border: none;
		border-radius: var(--radius-lg);
		background: var(--color-background-header);
		color: var(--color-text-primary);
		box-shadow: 0 8px 32px #0006;

		&::backdrop {
			background: #0008;
		}
	}

	h2 {
		margin: 0 0 var(--spacing-md);
	}

	p {
		margin: 0 0 var(--spacing-xl);
		line-height: 1.4;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}
</style>

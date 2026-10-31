<script lang="ts">
	import CloudAlertIcon from '@iconify-svelte/lucide/cloud-alert';
	import CloudCheckIcon from '@iconify-svelte/lucide/cloud-check';
	import CloudOffIcon from '@iconify-svelte/lucide/cloud-off';
	import CloudUploadIcon from '@iconify-svelte/lucide/cloud-upload';
	import RefreshIcon from '@iconify-svelte/lucide/refresh-cw';
	import { syncEngine } from './Sync.svelte';

	const pending = $derived(syncEngine.pendingChanges);
	const unsynced = $derived(pending === 1 ? '1 unsynced change' : `${pending} unsynced changes`);

	const label = $derived.by(() => {
		switch (syncEngine.status) {
			case 'syncing':
				return 'Syncing…';
			case 'offline':
				return pending ? `Offline · ${unsynced}` : 'Offline';
			case 'signed-out':
				return 'Not syncing: log in again';
			case 'error':
				return 'Sync failed';
			default:
				return pending ? unsynced : 'Synced';
		}
	});

	const hasProblem = $derived(syncEngine.status === 'error' || syncEngine.status === 'signed-out');
</script>

<!-- On narrow screens only the icon is shown; the label stays available to screen readers and as
     a tooltip. -->
<button
	class="syncStatus"
	class:hasProblem
	title={`${label} · Sync now`}
	onclick={() => syncEngine.retry()}
>
	{#if syncEngine.status === 'syncing'}
		<RefreshIcon class="spinning" width="20px" aria-hidden="true" />
	{:else if syncEngine.status === 'offline'}
		<CloudOffIcon width="20px" aria-hidden="true" />
	{:else if hasProblem}
		<CloudAlertIcon width="20px" aria-hidden="true" />
	{:else if pending}
		<CloudUploadIcon width="20px" aria-hidden="true" />
	{:else}
		<CloudCheckIcon width="20px" aria-hidden="true" />
	{/if}
	<span class="label">{label}</span>
</button>

<style>
	.syncStatus {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-lg);
		font-size: 0.9rem;
		white-space: nowrap;
		color: var(--color-text-primary);
		opacity: 0.7;
		cursor: pointer;

		&:hover {
			opacity: 1;
			background-color: #8882;
		}

		&.hasProblem {
			color: var(--color-red);
			opacity: 1;
		}
	}

	.syncStatus :global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 600px) {
		.label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.syncStatus :global(.spinning) {
			animation: none;
		}
	}
</style>

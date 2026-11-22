<script lang="ts">
	import { onMount } from 'svelte';
	import { confirmation } from '../components/Confirmation.svelte';
	import { fetchHistoryEnabled, setHistoryEnabled } from '../history/NoteHistory';

	// Whether the user keeps the history of their notes. Kept on the server, which keeps the
	// history too, so changing it needs a connection, like MCP access. See src/lib/history.ts.

	let { userId }: { userId: string } = $props();

	let enabled = $state<boolean | null>(null);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	onMount(async () => {
		try {
			enabled = await fetchHistoryEnabled();
		} catch (error) {
			console.warn('Could not load whether history is kept', error);
			problem = 'This needs a connection to the server.';
		}
	});

	async function setEnabled(on: boolean, input: HTMLInputElement) {
		if (!on) {
			const confirmed = await confirmation.ask({
				title: 'Turn off note history?',
				message:
					'The history of all your notes will be deleted, on all your devices, and on the server. This can’t be undone.',
				confirmLabel: 'Turn off and delete',
				danger: true
			});
			if (!confirmed) {
				input.checked = true;
				return;
			}
		}
		busy = true;
		problem = null;
		try {
			enabled = (await setHistoryEnabled(userId, on)) !== null;
		} catch (error) {
			console.warn('Could not change whether history is kept', error);
			problem = 'Note history couldn’t be changed. Are you online?';
			input.checked = enabled ?? false;
		} finally {
			busy = false;
		}
	}
</script>

<div class="preferenceItem">
	<div>
		<label for="history-enabled">Keep the history of notes</label>
		<p>
			Keeps earlier versions of your notes, so you can go back to one if something was changed or
			removed by mistake. A version is kept each time you start changing a note after a break, for
			up to 90 days. Notes others share with you follow what their owner chose. Turning this off
			deletes the history of all your notes.
		</p>
	</div>
	<input
		id="history-enabled"
		class="themedCheckbox"
		type="checkbox"
		checked={enabled ?? false}
		disabled={enabled === null || busy}
		onchange={(event) => setEnabled(event.currentTarget.checked, event.currentTarget)}
	/>
</div>

{#if problem}
	<div class="preferenceItem">
		<p class="problem">{problem}</p>
	</div>
{/if}

<style>
	/* Like the settings' other rows, whose styles are Settings.svelte's own. */
	.preferenceItem {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		min-height: 3rem;
		padding: var(--spacing-sm) var(--spacing-md);
		background-color: #fff1;

		&:nth-child(2) {
			border-radius: var(--radius-md) var(--radius-md) 0 0;
		}
		&:last-child {
			border-radius: 0 0 var(--radius-md) var(--radius-md);
		}
		&:nth-child(2):last-child {
			border-radius: var(--radius-md);
		}

		label {
			font-weight: 500;
			min-width: min(200px, 50%);
		}

		p {
			font-size: 0.8rem;
			color: var(--color-text-muted);
			line-height: 1.2;
		}
	}

	.problem {
		color: var(--color-red) !important;
	}
</style>

<script lang="ts">
	import CloseIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import type { NotePermission } from '../Database';
	import { listShares, shareNote, unshareNote, type NoteShare } from './Sharing';

	let {
		noteId,
		noteKey
	}: {
		noteId: string;
		/** The decrypted key of the note, which is encrypted again for each recipient. */
		noteKey: Uint8Array;
	} = $props();

	let shares = $state<NoteShare[] | null>(null);
	let username = $state('');
	let permission = $state<NotePermission>('edit');
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	/** Runs a sharing action, showing its error if it fails, and refreshes the list. */
	async function run(action: () => Promise<unknown>) {
		busy = true;
		errorMessage = null;
		try {
			await action();
			shares = await listShares(noteId);
			return true;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unexpected error';
			return false;
		} finally {
			busy = false;
		}
	}

	/** Loads the list when the popover opens, so it isn't fetched for every focused note. */
	export function load() {
		return run(async () => {});
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (await run(() => shareNote(noteId, noteKey, username, permission))) {
			username = '';
		}
	}
</script>

<section>
	<h3>Share</h3>
	<form {onsubmit}>
		<input
			aria-label="Username"
			placeholder="Username"
			autocomplete="off"
			bind:value={username}
			disabled={busy}
			required
		/>
		<select aria-label="Permission" bind:value={permission} disabled={busy}>
			<option value="edit">Can edit</option>
			<option value="view">Can view</option>
		</select>
		<Button class="sm" type="submit" disabled={busy}>Share</Button>
	</form>

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	{#if shares === null}
		{#if busy}
			<p>Loading…</p>
		{/if}
	{:else if shares.length === 0}
		<p>Not shared with anyone yet.</p>
	{:else}
		<ul>
			{#each shares as share (share.userId)}
				<li>
					<span>{share.username}</span>
					<select
						aria-label={`Permission of ${share.username}`}
						value={share.permissions}
						disabled={busy}
						onchange={(event) =>
							run(() =>
								shareNote(
									noteId,
									noteKey,
									share.username,
									event.currentTarget.value as NotePermission
								)
							)}
					>
						<option value="edit">Can edit</option>
						<option value="view">Can view</option>
					</select>
					<button
						aria-label={`Stop sharing with ${share.username}`}
						title="Stop sharing"
						disabled={busy}
						onclick={() => run(() => unshareNote(noteId, share.userId))}
					>
						<CloseIcon width="18px" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: min(22rem, 80vw);
		padding: var(--spacing-sm);
	}

	h3 {
		margin: 0;
		font-family: var(--font-family-display);
		font-size: 1.2rem;
	}

	form {
		display: flex;
		gap: var(--spacing-sm);

		input {
			flex: 1;
			min-width: 0;
		}
	}

	p {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.8;

		&.error {
			color: var(--color-red);
			opacity: 1;
		}
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs, 0.25rem);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);

		span {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		button {
			display: flex;
			padding: var(--spacing-xs, 0.25rem);
			border-radius: 50%;
			cursor: pointer;

			&:hover {
				background-color: #8882;
			}
		}
	}
</style>

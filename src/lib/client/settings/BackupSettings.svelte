<script lang="ts">
	import Button from '../components/Button.svelte';
	import { fileDrop } from '../components/FileDrop';
	import { describeRestore } from '#lib/backup.js';
	import { OfflineError } from '../Api';
	import {
		downloadBackup,
		readBackupManifest,
		restoreBackup,
		restoreErrorMessage
	} from '../backup/Backup';
	import { syncEngine } from '../sync/Sync.svelte';

	// Backups: everything of the user's on the server, as it's stored there, still encrypted. To
	// keep somewhere else, and restore here, or on another server into a new account (on the
	// register page). Making and restoring them needs the server.

	let busy = $state<'download' | 'restore' | null>(null);
	let status = $state<{ error: boolean; message: string } | null>(null);
	let fileInput = $state<HTMLInputElement>();

	async function download() {
		busy = 'download';
		status = null;
		try {
			// So changes made on this device are in it too.
			await syncEngine.syncNow();
			await downloadBackup();
		} catch (error) {
			console.warn('Could not download a backup', error);
			status = {
				error: true,
				message:
					error instanceof OfflineError
						? 'A backup needs a connection to the server.'
						: 'The backup couldn’t be made.'
			};
		} finally {
			busy = null;
		}
	}

	async function restore(file: File) {
		busy = 'restore';
		status = { error: false, message: 'Reading the backup…' };
		try {
			const zip = new Uint8Array(await file.arrayBuffer());
			readBackupManifest(zip);
			const summary = await restoreBackup(zip, (sent, total) => {
				status = {
					error: false,
					message: `Uploading the backup… ${Math.floor((sent / total) * 100)}%`
				};
			});
			status = { error: false, message: describeRestore(summary) };
			await syncEngine.syncNow();
		} catch (error) {
			console.warn('Could not restore a backup', error);
			status = { error: true, message: restoreErrorMessage(error) };
		} finally {
			busy = null;
		}
	}
</script>

<div class="backup" {@attach fileDrop(restore, busy === null)}>
	<div>
		<h3>Make a backup</h3>
		<p>
			Everything of yours on the server, exactly as it’s stored there: your notes, also deleted
			ones, their history, your tags and settings, and who you shared notes with. It’s still
			encrypted, so only your password unlocks it. Notes others shared with you aren’t in it.
		</p>
	</div>
	<div class="actions">
		<Button class="sm" disabled={busy !== null} onclick={download}>
			{busy === 'download' ? 'Making a backup…' : 'Download a backup'}
		</Button>
	</div>

	<div>
		<h3>Restore a backup</h3>
		<p>
			Brings back notes that are missing or were deleted since, and replaces notes that are older
			here than in the backup; their text is kept in their history, if you keep it. Nothing is
			deleted. To restore a backup of another account, create a new account from it, on the register
			page.
		</p>
	</div>
	<input
		bind:this={fileInput}
		id="backup-restore"
		type="file"
		accept=".zip,application/zip"
		hidden
		onchange={(event) => {
			const file = event.currentTarget.files?.[0];
			event.currentTarget.value = '';
			if (file) restore(file);
		}}
	/>
	<div class="actions">
		<Button class="sm" disabled={busy !== null} onclick={() => fileInput?.click()}>
			{busy === 'restore' ? 'Restoring…' : 'Choose a backup'}
		</Button>
	</div>

	{#if status}
		<p class="status" class:error={status.error} aria-live="polite">{status.message}</p>
	{/if}
</div>

<style>
	/* Like the export's card, in ExportAll.svelte. */
	.backup {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		border-radius: var(--radius-md);
		background-color: #fff1;

		h3 {
			font-weight: 500;
		}

		p {
			font-size: 0.8rem;
			color: var(--color-text-muted);
			line-height: 1.2;
		}

		.status {
			color: var(--color-text-primary);
		}

		.error {
			color: var(--color-red);
		}

		/* Set by the fileDrop attachment. */
		&:global([data-dropping]) {
			outline: 2px dashed var(--color-yellow);
			outline-offset: -2px;
		}
	}
</style>

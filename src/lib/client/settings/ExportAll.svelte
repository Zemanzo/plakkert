<script lang="ts">
	import Button from '../components/Button.svelte';
	import { buildExportZip, collectNotesForExport, dateFileName } from '../export/ExportNotes';
	import { downloadBlob } from '../serialization/TextAndMarkdown';
	import type { RuntimeUser } from '#lib/types.js';

	let {
		getUser
	}: {
		/** The user, with their keys, to decrypt the notes with. */
		getUser: () => Pick<RuntimeUser, 'id' | 'publicKeyUint8' | 'decodedPrivateKey'>;
	} = $props();

	/** The zip's password can be guessed offline, as fast as a computer can try. */
	const MIN_PASSWORD_LENGTH = 8;

	let usePassword = $state(true);
	let password = $state('');
	let busy = $state(false);
	let status = $state<{ error: boolean; message: string } | null>(null);

	const passwordProblem = $derived.by(() => {
		if (!usePassword) return null;
		if (password.length < MIN_PASSWORD_LENGTH) {
			return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
		}
		return null;
	});
	const canExport = $derived(!busy && !passwordProblem);

	const notesCount = (count: number) => (count === 1 ? '1 note' : `${count} notes`);

	async function exportAll() {
		busy = true;
		status = null;
		try {
			const { notes, failed } = await collectNotesForExport(getUser());
			if (notes.length === 0) {
				status = { error: true, message: 'There are no notes to export.' };
				return;
			}
			const zip = await buildExportZip(notes, usePassword ? password : undefined);
			downloadBlob(zip, `Plakkert ${dateFileName(new Date())}.zip`);
			status = {
				error: failed > 0,
				message:
					`Exported ${notesCount(notes.length)}.` +
					(failed > 0 ? ` ${notesCount(failed)} couldn’t be decrypted, and were left out.` : '')
			};
			password = '';
		} catch (error) {
			console.error('Export failed', error);
			status = { error: true, message: 'The notes couldn’t be exported.' };
		} finally {
			busy = false;
		}
	}
</script>

<div class="exportAll">
	<div>
		<h3>All notes as a zip</h3>
		<p>
			A Markdown file per note, in folders for your notes, the archive and the trash, with its tags,
			colour and dates at the top. Changes made on other devices are included once they’ve synced.
		</p>
	</div>

	<fieldset>
		<legend class="sr-only">Protection</legend>
		<label>
			<input type="radio" name="exportProtection" bind:group={usePassword} value={true} />
			With a password
		</label>
		<label>
			<input type="radio" name="exportProtection" bind:group={usePassword} value={false} />
			Without a password
		</label>
	</fieldset>

	{#if usePassword}
		<p>
			The notes are encrypted with AES-256, which most archive apps can open, such as 7-Zip, but not
			every one that comes with your computer. Files are named after when the note was created, as a
			zip’s file names aren’t encrypted.
		</p>
		<label class="password">
			Password
			<input type="password" autocomplete="new-password" bind:value={password} />
		</label>
		{#if password && passwordProblem}
			<p class="error">{passwordProblem}</p>
		{/if}
	{:else}
		<p class="warning">Anyone who gets hold of the file can read all of your notes.</p>
	{/if}

	<div class="actions">
		<Button class="sm" disabled={!canExport} onclick={exportAll}>
			{busy ? 'Exporting…' : 'Export'}
		</Button>
		{#if status}
			<p class:error={status.error} aria-live="polite">{status.message}</p>
		{/if}
	</div>
</div>

<style>
	.exportAll {
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

		fieldset {
			display: flex;
			flex-wrap: wrap;
			gap: var(--spacing-sm) var(--spacing-lg);
			border: none;

			label {
				display: flex;
				align-items: center;
				gap: var(--spacing-sm);
				cursor: pointer;
			}

			/* Without the padding and background the app gives text fields. */
			input {
				width: 1.1em;
				height: 1.1em;
				margin: 0;
				padding: 0;
				background: revert;
				accent-color: var(--color-yellow);
			}
		}

		.password {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			max-width: 20rem;
			font-size: 0.85rem;
		}

		.actions {
			display: flex;
			align-items: center;
			gap: var(--spacing-md);

			p {
				color: var(--color-text-primary);
			}
		}

		.warning,
		.error,
		.actions p.error {
			color: var(--color-red);
		}
	}
</style>

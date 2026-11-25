<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { register, registerFromBackup } from '#lib/client/auth/Account.js';
	import { fetchRegistrationMode } from '#lib/client/auth/AuthApi.js';
	import { ApiError, OfflineError } from '#lib/client/Api.js';
	import {
		readBackupManifest,
		restoreBackup,
		restoreErrorMessage
	} from '#lib/client/backup/Backup.js';
	import Button from '#lib/client/components/Button.svelte';
	import type { BackupManifest } from '#lib/backup.js';
	import type { RegistrationMode } from '#lib/registration.js';

	let username = $state('');
	let password = $state('');
	// Invite links look like /register?invite=..., so the code doesn't have to be typed.
	let inviteCode = $state(page.url.searchParams.get('invite') ?? '');
	let mode = $state<RegistrationMode | 'loading' | 'offline'>('loading');
	let isCreating = $state(false);
	let errorMessage = $state<string | null>(null);
	let progress = $state<string | null>(null);
	/** A backup to create the account from: it gets the backup's keys, and then its notes. */
	let backup = $state<{ zip: Uint8Array; manifest: BackupManifest } | null>(null);
	/** Set when the account was made, but its backup couldn't be restored. */
	let restoreFailed = $state(false);
	let backupInput = $state<HTMLInputElement>();

	async function chooseBackup(file: File) {
		errorMessage = null;
		try {
			const zip = new Uint8Array(await file.arrayBuffer());
			const manifest = readBackupManifest(zip);
			backup = { zip, manifest };
			if (!username) username = manifest.user.username;
		} catch (error) {
			backup = null;
			errorMessage = restoreErrorMessage(error);
		}
	}

	onMount(async () => {
		try {
			mode = await fetchRegistrationMode();
		} catch (error) {
			if (error instanceof OfflineError) {
				mode = 'offline';
			} else {
				// The server decides anyway; asking for a code is the most likely to be right.
				console.error('Could not check whether registration is open', error);
				mode = 'invite';
			}
		}
	});

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		isCreating = true;
		errorMessage = null;
		const code = mode === 'invite' ? inviteCode : undefined;
		try {
			if (backup) {
				await registerFromBackup(username, password, code, backup.manifest);
				try {
					await restoreBackup(backup.zip, (sent, total) => {
						progress = `Restoring the backup… ${Math.floor((sent / total) * 100)}%`;
					});
				} catch (error) {
					console.error('Restoring the backup failed', error);
					restoreFailed = true;
					errorMessage = restoreErrorMessage(error);
					return;
				}
			} else {
				await register(username, password, code);
			}
			await goto(resolve('/(notes)'), { replace: true });
		} catch (error) {
			console.error('Registration failed', error);
			if (error instanceof OfflineError) {
				errorMessage = 'You need to be online to create an account.';
			} else if (error instanceof ApiError && error.code === 'REGISTRATION_CLOSED') {
				mode = 'closed';
			} else {
				errorMessage = error instanceof Error ? error.message : 'Unexpected error';
			}
		} finally {
			isCreating = false;
			progress = null;
		}
	}
</script>

{#if mode === 'loading'}
	<p class="status">Loading…</p>
{:else if mode === 'offline'}
	<p class="status">You need to be online to create an account.</p>
{:else if mode === 'closed'}
	<p class="status">
		Registration is closed. Already have an account? <a href={resolve('/login')}>Log in</a>.
	</p>
{:else if restoreFailed}
	<p class="status error">
		Your account was made, but its backup couldn’t be restored: {errorMessage} You can try again in the
		<a href={resolve('/settings')}>settings</a>.
	</p>
{:else}
	<form {onsubmit}>
		<label for="username"> Username </label>
		<input
			id="username"
			type="text"
			name="username"
			autocomplete={null}
			bind:value={username}
			disabled={isCreating}
			required
		/>
		<label for="password">{backup ? 'Backup’s password' : 'Password'}</label>
		<input
			id="password"
			type="password"
			name="password"
			autocomplete="new-password"
			bind:value={password}
			disabled={isCreating}
			required
		/>
		{#if mode === 'invite'}
			<label for="inviteCode"> Invite code </label>
			<input
				id="inviteCode"
				type="text"
				name="inviteCode"
				autocomplete="off"
				spellcheck="false"
				bind:value={inviteCode}
				disabled={isCreating}
				required
			/>
		{/if}
		<Button type="submit" disabled={isCreating} class="submitButton">
			{backup ? 'Register and restore' : 'Register'}
		</Button>
	</form>
	<div class="fromBackup">
		{#if backup}
			<p>
				From the backup of {backup.manifest.user.username}, made {new Date(
					backup.manifest.exportedAt
				).toLocaleString()}. Use the password it was made with; you can change it later.
			</p>
			<button type="button" disabled={isCreating} onclick={() => (backup = null)}>
				Don’t use the backup
			</button>
		{:else}
			<button type="button" disabled={isCreating} onclick={() => backupInput?.click()}>
				Create the account from a backup
			</button>
		{/if}
		<input
			bind:this={backupInput}
			id="backup"
			type="file"
			accept=".zip,application/zip"
			hidden
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = '';
				if (file) chooseBackup(file);
			}}
		/>
	</div>
	{#if progress}
		<p aria-live="polite">{progress}</p>
	{/if}
	{#if !isCreating && errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}
{/if}

<style>
	form {
		margin: 2em auto;
		display: grid;
		grid-template-columns: min-content 1fr;
		grid-auto-rows: min-content;

		gap: 0.5em;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-display);
		font-size: 1.3rem;

		:global(.submitButton) {
			grid-column: 1 / -1;
			width: 50%;
			justify-self: center;
		}
	}

	label {
		text-align: right;
		white-space: nowrap;
	}

	.fromBackup {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		margin: 0 auto 1em;
		max-width: 40ch;
		text-align: center;

		p {
			font-size: 1rem;
		}

		button {
			text-decoration: underline;
			color: var(--color-text-muted);
		}
	}

	p {
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		text-align: center;

		&.status {
			margin: 2em var(--spacing-lg);
		}

		&.error {
			color: var(--color-red);
		}

		a {
			color: inherit;
		}
	}
</style>

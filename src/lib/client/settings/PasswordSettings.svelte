<script lang="ts">
	import Button from '../components/Button.svelte';
	import { ApiError, OfflineError } from '../Api';
	import { changeAccountPassword, WrongPasswordError } from '../auth/Account';

	// Changing the password needs the current one: it's what the private key is encrypted with.
	// There's no way to reset a forgotten password, as nobody else can decrypt the private key.

	let { username }: { username: string } = $props();

	let open = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let repeatedPassword = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let changed = $state(false);

	function close() {
		open = false;
		currentPassword = newPassword = repeatedPassword = '';
		problem = null;
	}

	function messageFor(error: unknown) {
		if (error instanceof WrongPasswordError) return 'The current password is wrong.';
		if (error instanceof OfflineError) return 'Changing your password needs a connection.';
		if (error instanceof ApiError) {
			if (error.status === 401) return 'You were logged out. Log in again, then try again.';
			if (error.code === 'PASSWORD_CHANGED') {
				return 'Your password was just changed on another device. Log in again with that one.';
			}
			if (error.status === 429) return 'Too many attempts. Try again in an hour.';
		}
		return 'Your password couldn’t be changed.';
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		problem = null;
		if (newPassword !== repeatedPassword) {
			problem = 'The new passwords don’t match.';
			return;
		}
		if (newPassword === currentPassword) {
			problem = 'The new password is the same as the current one.';
			return;
		}
		busy = true;
		try {
			await changeAccountPassword(currentPassword, newPassword);
			close();
			changed = true;
		} catch (error) {
			if (!(error instanceof WrongPasswordError))
				console.warn('Could not change the password', error);
			problem = messageFor(error);
		} finally {
			busy = false;
		}
	}
</script>

<div class="preferenceItem">
	<div class="password">
		<div class="heading">
			<div>
				<h3>Password</h3>
				<p>
					Your password unlocks your notes, so it can’t be reset if you forget it: not even the
					server can read your notes without it.
				</p>
			</div>
			{#if !open}
				<Button
					class="sm"
					onclick={() => {
						open = true;
						changed = false;
					}}
				>
					Change
				</Button>
			{/if}
		</div>

		{#if changed}
			<p class="done" aria-live="polite">
				Your password was changed. Other devices need to log in again with the new one.
			</p>
		{/if}

		{#if open}
			<form {onsubmit}>
				<!-- For password managers, so they update the password of the right account. -->
				<input type="text" autocomplete="username" value={username} hidden readonly />
				<label>
					Current password
					<input
						type="password"
						autocomplete="current-password"
						bind:value={currentPassword}
						disabled={busy}
						required
					/>
				</label>
				<label>
					New password
					<input
						type="password"
						autocomplete="new-password"
						bind:value={newPassword}
						disabled={busy}
						required
					/>
				</label>
				<label>
					Repeat the new password
					<input
						type="password"
						autocomplete="new-password"
						bind:value={repeatedPassword}
						disabled={busy}
						required
					/>
				</label>
				<p>
					You stay logged in here. Other devices are logged out, and need the new password to log in
					again.
				</p>
				{#if problem}
					<p class="error" aria-live="polite">{problem}</p>
				{/if}
				<div class="actions">
					<Button type="submit" class="sm" disabled={busy}>
						{busy ? 'Changing…' : 'Change password'}
					</Button>
					<Button
						type="button"
						class="sm"
						--bg="var(--color-input-background)"
						--text="var(--color-text-primary)"
						disabled={busy}
						onclick={close}
					>
						Cancel
					</Button>
				</div>
			</form>
		{/if}
	</div>
</div>

<style>
	/* Like the settings' other rows, whose styles are Settings.svelte's own. */
	.preferenceItem {
		display: flex;
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

		p {
			font-size: 0.8rem;
			color: var(--color-text-muted);
			line-height: 1.2;
		}
	}

	.password {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		flex: 1;

		.heading {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: var(--spacing-md);
		}

		h3 {
			font-weight: 500;
		}

		form {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
			margin-bottom: var(--spacing-sm);
		}

		label {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			max-width: 20rem;
			font-size: 0.85rem;
		}

		.actions {
			display: flex;
			gap: var(--spacing-sm);
		}

		.done {
			color: var(--color-text-primary);
		}

		.error {
			color: var(--color-red);
		}
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { register } from '#lib/client/auth/Account.js';
	import { fetchRegistrationMode } from '#lib/client/auth/AuthApi.js';
	import { ApiError, OfflineError } from '#lib/client/Api.js';
	import Button from '#lib/client/components/Button.svelte';
	import type { RegistrationMode } from '#lib/registration.js';

	let username = $state('');
	let password = $state('');
	// Invite links look like /register?invite=..., so the code doesn't have to be typed.
	let inviteCode = $state(page.url.searchParams.get('invite') ?? '');
	let mode = $state<RegistrationMode | 'loading' | 'offline'>('loading');
	let isCreating = $state(false);
	let errorMessage = $state<string | null>(null);

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
		try {
			await register(username, password, mode === 'invite' ? inviteCode : undefined);
			await goto(resolve('/(notes)'));
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
		<label for="password"> Password </label>
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
		<Button type="submit" disabled={isCreating} class="submitButton">Register</Button>
	</form>
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

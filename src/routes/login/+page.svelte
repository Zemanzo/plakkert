<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EyeIcon from '@iconify-svelte/charm/eye';
	import EyeSlashIcon from '@iconify-svelte/charm/eye-slash';
	import { login } from '#lib/client/auth/Account.js';
	import { getLastUsername } from '#lib/client/auth/Session.js';
	import Button from '#lib/client/components/Button.svelte';

	let username = $state(getLastUsername());
	let password = $state('');
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let showPassword = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		loading = true;
		errorMessage = null;
		try {
			await login(username, password);
			await goto(resolve('/'));
		} catch (error) {
			console.error('Login failed', error);
			errorMessage = error instanceof Error ? error.message : 'Unexpected error';
		} finally {
			loading = false;
		}
	}
</script>

<form {onsubmit}>
	<label for="username"> Username </label>
	<input
		id="username"
		name="username"
		autocomplete="username"
		bind:value={username}
		disabled={loading}
		required
	/>
	<div></div>
	<label for="password"> Password </label>
	<input
		id="password"
		type={showPassword ? 'text' : 'password'}
		name="password"
		autocomplete="current-password"
		bind:value={password}
		disabled={loading}
		required
	/>
	<button
		type="button"
		class="password-toggle"
		onclick={(e) => {
			e.preventDefault();
			showPassword = !showPassword;
		}}
	>
		{#if showPassword}
			<EyeIcon width="32px" />
		{:else if !showPassword}
			<EyeSlashIcon width="32px" />
		{/if}
	</button>
	<Button type="submit" disabled={loading} class="submitButton">Login</Button>
</form>
{#if !loading && errorMessage}
	<p>{errorMessage}</p>
{/if}

<style>
	form {
		margin: 2em auto;
		display: grid;
		grid-template-columns: min-content 1fr min-content;
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
	}

	p {
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		color: var(--color-red);
		text-align: center;
	}

	.password-toggle {
		width: 32px;
		height: 32px;
		color: var(--text-color-primary);
		cursor: pointer;
	}

	input[type='password'] ~ .password-toggle {
		opacity: 0.5;
	}
</style>

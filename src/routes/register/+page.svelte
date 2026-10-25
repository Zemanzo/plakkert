<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { register } from '#lib/client/auth/Account.js';
	import { OfflineError } from '#lib/client/Api.js';
	import Button from '#lib/client/components/Button.svelte';

	let username = $state('');
	let password = $state('');
	let isCreating = $state(false);
	let errorMessage = $state<string | null>(null);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		isCreating = true;
		errorMessage = null;
		try {
			await register(username, password);
			await goto(resolve('/'));
		} catch (error) {
			console.error('Registration failed', error);
			if (error instanceof OfflineError) {
				errorMessage = 'You need to be online to create an account.';
			} else {
				errorMessage = error instanceof Error ? error.message : 'Unexpected error';
			}
		} finally {
			isCreating = false;
		}
	}
</script>

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
	<Button type="submit" disabled={isCreating} class="submitButton">Register</Button>
</form>
{#if !isCreating && errorMessage}
	<p>{errorMessage}</p>
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
	}

	p {
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		color: var(--color-red);
		text-align: center;
	}
</style>

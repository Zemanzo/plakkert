<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import EyeIcon from '@iconify-svelte/charm/eye';
	import EyeSlashIcon from '@iconify-svelte/charm/eye-slash';
	import type { ActionData } from './$types';
	import { db } from '#lib/client/Database.js';
	import {
		decryptPrivateKey,
		sessionStorePrivateKey
	} from '#lib/client/cryptography/PrivateKey.js';
	import { defaultPreferences } from '#lib/client/settings/Preferences.js';
	import Button from '#lib/client/components/Button.svelte';

	let { form }: { form: ActionData } = $props();
	let loading = $state(false);
	let success = $state(false);
	let showPassword = $state(false);

	/**
	 * Retrieves the signed-in user from the server and stores it in the local
	 * IndexedDB, keeping any local preferences.
	 */
	async function storeCurrentUser() {
		const response = await fetch('/api/user');
		if (!response.ok) {
			throw new Error('Failed to fetch user data');
		}

		const userData = await response.json();
		const existingUser = await db.users.get(userData.id);

		const currentUser = {
			id: userData.id,
			username: userData.username,
			email: userData.email,
			publicKey: userData.publicKey,
			privateKey: Uint8Array.fromBase64(userData.privateKey),
			salt: Uint8Array.fromBase64(userData.salt),
			nonce: Uint8Array.fromBase64(userData.nonce),
			preferences: existingUser?.preferences ?? defaultPreferences
		};

		await db.users.put(currentUser);
		return currentUser;
	}
</script>

<form
	method="post"
	action="?/signInUsername"
	use:enhance={() => {
		loading = true;
		return async ({ result, formData }) => {
			loading = false;
			if (result.type === 'redirect') {
				success = true;
				const password = formData.get('password') as string;
				// Always refresh the local copy from the server, so the user is matched by ID rather
				// than by the (normalized) username.
				const currentUser = await storeCurrentUser();
				const decryptedKeyBuffer = await decryptPrivateKey(
					currentUser.privateKey,
					password,
					currentUser.salt,
					currentUser.nonce
				);
				sessionStorePrivateKey(new Uint8Array(decryptedKeyBuffer));
				await refreshAll();
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(result.location);
			} else {
				console.log(result);
				await applyAction(result);
			}
		};
	}}
>
	<label for="username"> Username </label>
	<input id="username" name="username" autocomplete="username" disabled={loading} required />
	<div></div>
	<label for="password"> Password </label>
	<input
		id="password"
		type={showPassword ? 'text' : 'password'}
		name="password"
		autocomplete="current-password"
		disabled={loading}
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
{#if !loading && !success && form?.message}
	<p>{form.message}</p>
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

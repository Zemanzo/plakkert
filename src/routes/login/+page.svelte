<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ActionData } from './$types';
	import { db } from '$lib/client/Database';
	import { decryptPrivateKey } from '$lib/client/cryptography/PrivateKey';
	import { defaultPreferences } from '$lib/client/settings/Preferences';
	import Button from '$lib/client/components/Button.svelte';

	let { form }: { form: ActionData } = $props();
	let loading = $state(false);
	let success = $state(false);

	/**
	 * Retrieves user data from the server and adds it to the local IndexedDB if
	 * the user does not already exist.
	 */
	async function addExistingUserToDatabase(userId: string, username: string) {
		try {
			const response = await fetch('/api/user');
			if (!response.ok) {
				throw new Error('Failed to fetch user data');
			}

			const userData = await response.json();

			// Check if user already exists locally
			const existingUser = await db.users.where('username').equals(username).first();
			if (existingUser) {
				return;
			}

			// Store user with placeholder values for encrypted fields
			// These will be derived from the password when needed
			await db.users.add({
				id: userId,
				username: userData.username,
				email: userData.email,
				publicKey: userData.publicKey,
				privateKey: new Uint8Array(),
				passwordHash: new Uint8Array(),
				salt: new Uint8Array(),
				nonce: new Uint8Array(),
				preferences: defaultPreferences
			});
		} catch (error) {
			console.error('Error adding user to database:', error);
			throw error;
		}
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
				const username = formData.get('username') as string;
				const password = formData.get('password') as string;
				const user = await db.users.where('username').equals(username).first();
				if (user) {
					const decryptedKeyBuffer = await decryptPrivateKey(
						user.privateKey,
						password,
						user.salt,
						user.nonce
					);
					sessionStorage.setItem(
						'privateKey',
						btoa(String.fromCharCode(...new Uint8Array(decryptedKeyBuffer)))
					);
				} else {
					// Add existing user to database if not found - retrieve user data from server
					try {
						const response = await fetch('/api/user');
						if (response.ok) {
							const userData = await response.json();
							await addExistingUserToDatabase(userData.id, username);
						}
					} catch (error) {
						console.error('Failed to add user to database:', error);
						throw new Error('Failed to add user to database', { cause: error });
					}
				}
				await invalidateAll();
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
	<label for="password"> Password </label>
	<input
		id="password"
		type="password"
		name="password"
		autocomplete="current-password"
		disabled={loading}
	/>
	<Button type="submit" disabled={loading} class="submitButton">Login</Button>
</form>
{#if !loading && !success && form?.message}
	<p>{form.message}</p>
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

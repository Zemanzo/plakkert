<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { ActionData } from './$types';
	import _sodium from 'libsodium-wrappers';
	import { db } from '$lib/client/Database';
	import { encryptPrivateKey } from '$lib/client/cryptography/PrivateKey';
	import { defaultPreferences } from '$lib/client/settings/Preferences';
	import Button from '$lib/client/components/Button.svelte';

	async function initCrypto() {
		// Always wait for the WASM binary to load completely
		await _sodium.ready;
		return _sodium;
	}

	let publicKeyStr = $state<string | undefined>(),
		privateKeyBuffer = $state<Uint8Array | undefined>();

	async function generateUserKeys() {
		const sodium = await initCrypto();

		const { publicKey, privateKey } = sodium.crypto_box_keypair();

		return {
			publicKey,
			privateKey
		};
	}
	onMount(async () => {
		const keys = await generateUserKeys();
		publicKeyStr = btoa(String.fromCharCode(...keys.publicKey));
		privateKeyBuffer = keys.privateKey;
	});

	let { form }: { form: ActionData } = $props();
	let isCreating = $state(false);
	let success = $state(false);
</script>

<form
	method="post"
	action="?/signUpEmail"
	use:enhance={async ({ formData }) => {
		isCreating = true;

		const password = formData.get('password') as string;
		const { encryptedKey, salt, nonce, passwordHash } = await encryptPrivateKey(
			privateKeyBuffer!,
			password
		);

		formData.append('privateKey', btoa(String.fromCharCode(...encryptedKey)));
		formData.append('salt', btoa(String.fromCharCode(...salt)));
		formData.append('nonce', btoa(String.fromCharCode(...nonce)));

		return async ({ result, update, formData }) => {
			await update();
			if (result.type === 'success') {
				try {
					success = true;
					const id = result.data?.id as string;
					const publicKey = formData.get('publicKey') as string;
					const email = formData.get('email') as string;

					if (!id || !password || !publicKey || !email) {
						console.error('Missing required form data');
						isCreating = false;
						return;
					}

					await db.users.add(
						{
							id,
							email,
							privateKey: new Uint8Array(encryptedKey),
							publicKey: publicKeyStr!,
							passwordHash: new Uint8Array(passwordHash),
							salt,
							nonce,
							preferences: defaultPreferences
						},
						id
					);

					sessionStorage.setItem('privateKey', btoa(String.fromCharCode(...privateKeyBuffer!)));
					// Redirect to login page or home page after successful registration
					window.location.href = '/';
				} catch (error) {
					console.error('Failed to store encrypted key in IndexedDB', error);
					throw error;
				}
			} else if (result.type === 'error') {
				console.error('Form submission failed', result.error);
			} else if (result.type === 'failure') {
				console.error('Form validation failed', result.data);
			}
			isCreating = false;
		};
	}}
>
	<label for="email"> Email </label>
	<input id="email" type="email" name="email" autocomplete={null} disabled={isCreating} />
	<label for="password"> Password </label>
	<input
		id="password"
		type="password"
		name="password"
		autocomplete="new-password"
		disabled={isCreating}
	/>
	<label for="name"> Name </label>
	<input id="name" type="name" name="name" disabled={isCreating} />
	<input type="hidden" name="publicKey" required value={publicKeyStr} />
	<Button type="submit" disabled={isCreating} class="submitButton">Register</Button>
</form>
{#if !isCreating && !success && form?.message}
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

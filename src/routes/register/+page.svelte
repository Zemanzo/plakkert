<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { ActionData } from './$types';
	import _sodium from 'libsodium-wrappers';
	import { db } from '$lib/client/Database';
	import { encryptPrivateKey } from '$lib/client/cryptography/PrivateKey';

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
</script>

<h1>Register</h1>
<form
	method="post"
	action="?/signUpEmail"
	use:enhance={() => {
		isCreating = true;

		return async ({ result, update, formData }) => {
			await update();
			if (result.type === 'success') {
				try {
					const id = result.data?.id as string;
					const password = formData.get('password') as string;
					const publicKey = formData.get('publicKey') as string;
					const email = formData.get('email') as string;

					if (!id || !password || !publicKey || !email) {
						console.error('Missing required form data');
						isCreating = false;
						return;
					}

					const { encryptedKey, salt, nonce, passwordHash } = await encryptPrivateKey(
						privateKeyBuffer!,
						password
					);

					await db.users.add(
						{
							id,
							email,
							privateKey: new Uint8Array(encryptedKey),
							publicKey: publicKeyStr!,
							passwordHash: new Uint8Array(passwordHash),
							salt,
							nonce
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
	<label>
		Email
		<input disabled={isCreating} type="email" name="email" />
	</label>
	<label>
		Password
		<input disabled={isCreating} type="password" name="password" />
	</label>
	<label>
		Name
		<input disabled={isCreating} type="name" name="name" />
	</label>
	<input type="hidden" name="publicKey" required value={publicKeyStr} />
	<button>Register</button>
</form>
<p style="color: red">{form?.message ?? ''}</p>

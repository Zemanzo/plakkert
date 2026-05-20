<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { ActionData } from './$types';
	import _sodium from 'libsodium-wrappers';
	import { db } from '$lib/client/Database';

	async function initCrypto() {
		// Always wait for the WASM binary to load completely
		await _sodium.ready;
		return _sodium;
	}

	let publicKeyStr = $state<string | undefined>(),
		privateKeyStr = $state<string | undefined>();

	async function generateUserKeys() {
		const sodium = await initCrypto();

		const { publicKey, privateKey } = sodium.crypto_box_keypair();

		return {
			publicKeyStr: sodium.to_base64(publicKey),
			privateKeyStr: sodium.to_base64(privateKey)
		};
	}
	onMount(async () => {
		const keys = await generateUserKeys();
		publicKeyStr = keys.publicKeyStr;
		privateKeyStr = keys.privateKeyStr;
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
					const email = formData.get('email') as string;

					if (!id || !password || !email) {
						console.error('Missing required form data');
						isCreating = false;
						return;
					}

					// 1. Generate a random salt
					const salt = crypto.getRandomValues(new Uint8Array(16));

					// 2. Derive a 32-byte key from the password using PBKDF2
					const passwordBuffer = new TextEncoder().encode(password);
					const baseKey = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
						'deriveKey',
						'deriveBits'
					]);
					const passwordHash = await crypto.subtle.deriveBits(
						{
							name: 'PBKDF2',
							salt,
							iterations: 100_000,
							hash: 'SHA-256'
						},
						baseKey,
						256
					);
					const derivedKey = await crypto.subtle.deriveKey(
						{
							name: 'PBKDF2',
							salt,
							iterations: 100_000,
							hash: 'SHA-256'
						},
						baseKey,
						{ name: 'AES-GCM', length: 256 },
						true,
						['encrypt']
					);

					// 3. Encrypt the private key
					const nonce = crypto.getRandomValues(new Uint8Array(12));
					const privateKeyBuffer = new TextEncoder().encode(privateKeyStr!);
					const encryptedKey = await crypto.subtle.encrypt(
						{ name: 'AES-GCM', iv: nonce },
						derivedKey,
						privateKeyBuffer
					);
					await db.users.add({
						id,
						email,
						privateKey: encryptedKey,
						passwordHash: passwordHash,
						salt,
						nonce
					});

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

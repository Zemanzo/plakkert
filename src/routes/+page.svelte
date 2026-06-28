<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import NotesContainer from '$lib/client/NotesContainer.svelte';
	import { db } from '$lib/client/Database';
	import {
		decodeKey,
		decryptPrivateKey,
		sessionGetPrivateKey,
		sessionStorePrivateKey
	} from '$lib/client/cryptography/PrivateKey';
	import type { RuntimeUser } from '$lib/types';

	let { data } = $props();

	let user = $state<RuntimeUser | undefined>();
	let showPasswordPrompt = $state(false);
	let passwordForm = $state<HTMLFormElement | null>(null);

	onMount(async () => {
		if (!data.user.id) {
			throw new Error('User ID is missing from page data');
		}
		const dbUser = await db.users.get(data.user.id);
		const decodedPrivateKey = sessionGetPrivateKey();
		if (dbUser) {
			user = {
				...dbUser,
				decodedPrivateKey,
				publicKeyUint8: decodeKey(dbUser.publicKey)
			};
			if (!decodedPrivateKey) {
				showPasswordPrompt = true;
			}
		} else {
			// TODO: Retrieve data from server and store in IndexedDB.
			throw new Error('User not found in database');
		}
	});

	setContext('user', () => user);
</script>

<main>
	{#if showPasswordPrompt && user}
		<form
			bind:this={passwordForm}
			onsubmit={async (event) => {
				event.preventDefault();

				const formData = new FormData(passwordForm!);
				const password = formData.get('password') as string;

				try {
					const decryptedKeyBuffer = await decryptPrivateKey(
						user!.privateKey,
						password,
						user!.salt,
						user!.nonce
					);
					sessionStorePrivateKey(new Uint8Array(decryptedKeyBuffer));
					user = { ...user!, decodedPrivateKey: new Uint8Array(decryptedKeyBuffer) };
					showPasswordPrompt = false;
				} catch (error) {
					console.error('Failed to decrypt private key:', error);
					alert('Failed to decrypt your private key. Please check your password and try again.');
				}
			}}
		>
			<label for="password">Enter your password to decrypt your notes</label>
			<input type="password" name="password" placeholder="" />
		</form>
	{:else if !user}
		<p class="loadingIndicator">Loading user data...</p>
	{:else}
		<NotesContainer />
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;

		.loadingIndicator {
			opacity: 0;
			animation-name: fade-in;
			animation-duration: 0.2s;
			animation-delay: 0.18s;
			animation-timing-function: ease;
			animation-fill-mode: forwards;
		}
	}

	@keyframes fade-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}

	form {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;

		label {
			font-family: var(--font-family-display);
			font-size: 1.3rem;
		}
	}
</style>

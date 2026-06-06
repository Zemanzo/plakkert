<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { onMount, setContext } from 'svelte';
	import NotesContainer from '$lib/client/NotesContainer.svelte';
	import type { PageServerData } from './$types';
	import { db } from '$lib/client/Database';
	import {
		decodeKey,
		decryptPrivateKey,
		sessionGetPrivateKey,
		sessionRemovePrivateKey,
		sessionStorePrivateKey
	} from '$lib/client/cryptography/PrivateKey';
	import type { RuntimeUser } from '$lib/types';

	let { data }: { data: PageServerData } = $props();

	let user = $state<RuntimeUser | undefined>();
	let showPasswordPrompt = $state(false);
	let passwordForm = $state<HTMLFormElement | null>(null);

	onMount(async () => {
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
		}
	});

	setContext('user', () => user);
</script>

<svelte:head>
	<title>Plakkert</title>
</svelte:head>
<header>
	<h1>Plakkert</h1>
	<p>Your user ID is {data.user.id}.</p>
	<form
		method="post"
		action="?/signOut"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'redirect') {
					sessionRemovePrivateKey();
				}
				await applyAction(result);
			};
		}}
	>
		<button>Sign out</button>
	</form>
</header>

<main>
	{#if showPasswordPrompt}
		<form
			bind:this={passwordForm}
			onsubmit={async (event) => {
				event.preventDefault();

				const formData = new FormData(passwordForm!);
				const password = formData.get('password') as string;

				const decryptedKeyBuffer = await decryptPrivateKey(
					user!.privateKey,
					password,
					user!.salt,
					user!.nonce
				);
				sessionStorePrivateKey(new Uint8Array(decryptedKeyBuffer));
				user = { ...user!, decodedPrivateKey: new Uint8Array(decryptedKeyBuffer) };
				showPasswordPrompt = false;
			}}
		>
			<input
				type="password"
				name="password"
				placeholder="Enter your password to decrypt your notes"
			/>
		</form>
	{:else if !user}
		<p>Loading user data...</p>
	{:else}
		<NotesContainer />
	{/if}
</main>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-background-header);

		h1 {
			margin: 0 0 0 var(--spacing-lg);
		}

		p {
			margin: 0;
			margin-block: 0;
		}
	}

	main {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
	}
</style>

<script lang="ts">
	import { setContext } from 'svelte';
	import NotesContainer from '#lib/client/note/NotesContainer.svelte';
	import { decodeKey } from '#lib/client/cryptography/PrivateKey.js';
	import { getUnlockedSession } from '#lib/client/auth/Session.js';
	import { localUser } from '#lib/client/User.svelte.js';
	import type { RuntimeUser } from '#lib/types.js';

	// The layout redirects to the login page when there is no unlocked session.
	const session = getUnlockedSession();

	const user = $derived.by<RuntimeUser | undefined>(() => {
		const dbUser = localUser.data;
		if (!session || !dbUser || dbUser.id !== session.userId) return undefined;
		return {
			...dbUser,
			decodedPrivateKey: session.privateKey,
			publicKeyUint8: decodeKey(dbUser.publicKey)
		};
	});

	setContext('user', () => user);
</script>

<main>
	{#if !user}
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
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: center;
			margin-top: 2rem;
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
</style>

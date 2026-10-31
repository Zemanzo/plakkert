<script lang="ts">
	import { setContext, untrack } from 'svelte';
	import { decodeKey } from '#lib/client/cryptography/PrivateKey.js';
	import { getUnlockedSession } from '#lib/client/auth/Session.js';
	import { localUser } from '#lib/client/User.svelte.js';
	import { NoteStore } from '#lib/client/note/NoteStore.svelte.js';
	import { purgeExpiredTrash } from '#lib/client/note/NoteActions.js';
	import NotesNav from '#lib/client/note/NotesNav.svelte';
	import { syncEngine } from '#lib/client/sync/Sync.svelte.js';
	import type { RuntimeUser } from '#lib/types.js';

	let { children } = $props();

	// The root layout redirects to the login page when there is no unlocked session.
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
	const userId = $derived(user?.id);

	let store = $state<NoteStore | null>(null);

	setContext('user', () => user);
	setContext('notes', () => store);

	$effect(() => {
		// Only restart when the user changes, not when e.g. their preferences are saved.
		if (!userId) return;
		const noteStore = new NoteStore(untrack(() => user)!);
		const stop = noteStore.start();
		store = noteStore;
		return () => {
			stop();
			store = null;
		};
	});

	$effect(() => {
		// Clear out expired trash, but only once the notes are up to date with the server (see
		// purgeExpiredTrash). Runs again when the notes change, as notes that were just pulled
		// are decrypted after the sync finishes.
		const { lastPulledAt } = syncEngine;
		const entries = store?.entries;
		if (lastPulledAt && entries && userId) {
			void purgeExpiredTrash(entries, userId, lastPulledAt);
		}
	});
</script>

{#if !user || !store}
	<p class="loadingIndicator">Loading user data...</p>
{:else}
	<div class="notesLayout">
		<NotesNav />
		<main>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.notesLayout {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

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

	@keyframes fade-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}

	@media (max-width: 700px) {
		.notesLayout {
			flex-direction: column;
		}
	}
</style>

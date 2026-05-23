<script lang="ts">
	import { enhance } from '$app/forms';
	import { setContext } from 'svelte';
	import NotesContainer from '$lib/client/NotesContainer.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	setContext('user', data.user);
</script>

<header>
	<h1>Plakkert</h1>
	<p>Your user ID is {data.user.id}.</p>
	<form method="post" action="?/signOut" use:enhance>
		<button>Sign out</button>
	</form>
</header>

<main>
	<NotesContainer />
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

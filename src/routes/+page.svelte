<script lang="ts">
	import { enhance } from '$app/forms';
	import Note from '$lib/client/Note.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<h1>Hi, {data.user.name}!</h1>
<p>Your user ID is {data.user.id}.</p>
<form method="post" action="?/signOut" use:enhance>
	<button>Sign out</button>
</form>

<Note />

<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/client/Header.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { localUser } from '$lib/client/User.svelte';

	let { children, data } = $props();

	$effect(() => {
		// (Re-)initialize localUser as otherwise it will lose the user state when navigating to a new page.
		localUser.init(page.data.user?.id);
	});

	onMount(() => {
		$effect(() => {
			if (!localUser.isLoading) {
				switch (localUser?.data?.preferences?.theme) {
					case 'light':
						document.documentElement.style.colorScheme = 'light';
						break;
					case 'dark':
						document.documentElement.style.colorScheme = 'dark';
						break;
					case 'system':
						document.documentElement.style.colorScheme = 'light dark';
						break;
					// No default, the fallback is already set in the server hooks.
				}
			}
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<Header user={data.user} />
{@render children()}

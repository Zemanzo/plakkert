<script lang="ts">
	import './layout.css';
	import Header from '#lib/client/Header.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { localUser } from '#lib/client/User.svelte.js';
	import { getUnlockedSession } from '#lib/client/auth/Session.js';
	import { applyTheme } from '#lib/client/settings/Preferences.js';
	import { syncEngine } from '#lib/client/sync/Sync.svelte.js';

	let { children } = $props();

	const PUBLIC_ROUTES: (string | null)[] = ['/login', '/register'];

	$effect(() => {
		// Pages are a static shell, so access is decided here: only a user that has unlocked their
		// private key in this tab can see their notes. The API checks the server session itself.
		const session = getUnlockedSession();
		const routeId = page.route.id;

		// (Re-)initialize localUser as otherwise it will lose the user state when navigating to a new page.
		localUser.init(session?.userId);

		if (!session && !PUBLIC_ROUTES.includes(routeId)) {
			goto(resolve('/login'), { replace: true });
		} else if (session && routeId === '/login') {
			goto(resolve('/'), { replace: true });
		}
	});

	$effect(() => {
		const user = localUser.data;
		// Sync in the background for as long as the user is unlocked; logout() stops it.
		if (user && getUnlockedSession()?.userId === user.id) {
			syncEngine.start({ id: user.id, username: user.username });
		}
	});

	$effect(() => {
		const theme = localUser.data?.preferences?.theme;
		// Without a user, the theme remembered by app.html stays in place.
		if (theme) {
			applyTheme(theme);
		}
	});
</script>

<Header />
{@render children()}

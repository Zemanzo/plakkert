<script lang="ts">
	import './layout.css';
	import Header from '#lib/client/Header.svelte';
	import ConfirmDialog from '#lib/client/components/ConfirmDialog.svelte';
	import Toasts from '#lib/client/components/Toasts.svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { localUser } from '#lib/client/User.svelte.js';
	import { afterLogin, getUnlockedSession, keepUnlockedSession } from '#lib/client/auth/Session.js';
	import { applyTheme, preferencesOf } from '#lib/client/settings/Preferences.js';
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
			// An MCP client's sign-in comes back after logging in.
			const next = afterLogin(page.url.pathname + page.url.search);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus a query
			goto(resolve('/login') + (next ? `?next=${encodeURIComponent(next)}` : ''), {
				replace: true
			});
		} else if (session && routeId === '/login') {
			const next = afterLogin(page.url.searchParams.get('next'));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- checked by afterLogin
			goto(next ?? resolve('/(notes)'), { replace: true });
		}
	});

	// Like an app, the history is at most two entries deep: all notes, and the section that is open,
	// e.g. the settings, the archive or a tag. Going back from a section shows all notes, and going
	// back from there leaves the app, however much was opened in between. An open note adds an
	// entry of its own, which going back closes.
	const isMain = (url: { pathname: string; search: string }) =>
		url.pathname === resolve('/(notes)') && url.search === '';

	beforeNavigate((navigation) => {
		const to = navigation.to?.url;
		if (navigation.type !== 'link' || !navigation.from || !to) return;
		navigation.cancel();
		void openSection(to);
	});

	async function openSection(to: URL) {
		// Close the open note first, as if going back, so its entry doesn't stay behind.
		while (page.state.openNoteId) {
			const popped = new Promise((resolve) =>
				addEventListener('popstate', resolve, { once: true })
			);
			history.back();
			await popped;
			await tick();
		}
		if (isMain(page.url)) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a link's own URL
			if (!isMain(to)) await goto(to, { state: { fromMain: true } });
		} else if (isMain(to) && page.state.fromMain) {
			history.back();
		} else {
			// The app may have been opened at a section, with no entry for all notes before it.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a link's own URL
			await goto(to, { replace: true, state: { fromMain: page.state.fromMain } });
		}
	}

	$effect(() => {
		const user = localUser.data;
		// Sync in the background for as long as the user is unlocked; logout() stops it.
		if (user && getUnlockedSession()?.userId === user.id) {
			syncEngine.start({ id: user.id, username: user.username });
		}
	});

	$effect(() => {
		const user = localUser.data;
		// Runs again on every page, so a remembered session lasts for a while after the app was last
		// used, rather than since logging in. Turning "Stay logged in" off forgets it right away.
		void page.route.id;
		const session = getUnlockedSession();
		if (user && session?.userId === user.id) {
			keepUnlockedSession(session, preferencesOf(user).stayLoggedIn);
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
<Toasts />
<ConfirmDialog />

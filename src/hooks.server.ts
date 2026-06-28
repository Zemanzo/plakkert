import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { COOKIE_PREFIX } from '$lib/client/settings/Preferences';

// 1. Better Auth Session Provider
const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

// 2. Theme Handler
const handleTheme: Handle = async ({ event, resolve }) => {
	// set the 'theme' cookie, defaulting to 'light' if it doesn't exist yet
	const theme = event.cookies.get(`${COOKIE_PREFIX}theme`) || 'light dark';

	console.log(event.cookies.get(`${COOKIE_PREFIX}theme`));

	// Intercept the HTML response chunk and swap out our placeholder
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%theme%', theme)
	});

	return response;
};

// 3. Global Route Guard
const handleAuthGuard: Handle = async ({ event, resolve }) => {
	const user = event.locals.user;
	const pathname = event.url.pathname;

	// Define exceptions so we don't cause an infinite redirect loop
	const isLoginPage = pathname === '/login';
	const isRegisterPage = pathname === '/register';
	const isAuthApi = pathname.startsWith('/api/auth'); // Better Auth's default endpoint prefix

	if (!user && !isLoginPage && !isRegisterPage && !isAuthApi) {
		throw redirect(302, '/login');
	}

	if (user && isLoginPage) {
		throw redirect(302, '/');
	}

	return await resolve(event);
};

export const handle: Handle = sequence(handleBetterAuth, handleTheme, handleAuthGuard);

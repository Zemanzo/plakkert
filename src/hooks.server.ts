import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

// 1. Better Auth Session Provider
const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

// 2. Global Route Guard
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

export const handle: Handle = sequence(handleBetterAuth, handleAuthGuard);

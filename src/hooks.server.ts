import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.js';
import { svelteKitHandler } from 'better-auth/svelte-kit';

// Pages are prerendered and served as static files, so this only runs for `/api` requests. Those
// endpoints check `locals.user` themselves; Better Auth handles `/api/auth`.
export const handle: Handle = async ({ event, resolve }) => {
	if (!building) {
		const session = await auth.api.getSession({ headers: event.request.headers });

		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

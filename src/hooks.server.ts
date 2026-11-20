import type { Handle } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { MCP, ORIGIN } from '$app/env/private';
import { auth } from '#lib/server/auth.js';
import { isMcpPath } from '#lib/server/mcp/paths.js';
import { svelteKitHandler } from 'better-auth/svelte-kit';

/** Endpoints that take forms from other sites: they don't use cookies, so CSRF doesn't apply. */
const CSRF_EXEMPT = new Set(['/api/oauth/token']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * SvelteKit's CSRF check, which vite.config.ts turns off so the OAuth token endpoint can be
 * exempt: refuses changes posted as a form (or without a content type) from another site, as
 * browsers send those with the user's cookies.
 */
function isCrossSiteForm(request: Request, pathname: string) {
	if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
	if (CSRF_EXEMPT.has(pathname)) return false;
	const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
	if (type && !FORM_TYPES.includes(type)) return false;
	const origin = request.headers.get('origin');
	return origin !== (ORIGIN || new URL(request.url).origin);
}

// Pages are prerendered and served as static files, so this only runs for the API, the MCP
// endpoint and the OAuth metadata. Those check `locals.user` themselves, or a bearer token for
// MCP; Better Auth handles `/api/auth`.
export const handle: Handle = async ({ event, resolve }) => {
	// Like SvelteKit's, not while developing, where the origin may differ from ORIGIN.
	if (!building && !dev && isCrossSiteForm(event.request, event.url.pathname)) {
		return new Response(`Cross-site ${event.request.method} form submissions are forbidden`, {
			status: 403
		});
	}

	// Unless the server allows MCP, it doesn't exist: no endpoint, no OAuth, no settings for it.
	if (!building && !MCP && isMcpPath(event.url.pathname)) {
		return new Response('Not found', { status: 404 });
	}

	if (!building) {
		const session = await auth.api.getSession({ headers: event.request.headers });

		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

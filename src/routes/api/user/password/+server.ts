import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';
import { changePassword, parsePasswordChange } from '#lib/server/password.js';

/** Per user, so a stolen session can't be used to guess the current password quickly. */
const allowed = rateLimiter(10, 60 * 60 * 1000);

/**
 * Changes the user's password, along with the private key encrypted with it. See
 * `changePassword`. Forgotten passwords can't be reset: without the old password, the private
 * key can't be decrypted, and so neither can the notes.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) throw error(401, 'Unauthorized');
	if (!allowed(locals.user.id)) {
		return Response.json(
			{ message: 'Too many attempts, try again later', code: 'TOO_MANY_ATTEMPTS' },
			{ status: 429 }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	const change = parsePasswordChange(body);
	if ('problem' in change) return Response.json({ message: change.problem }, { status: 400 });

	const result = await changePassword(locals.user.id, locals.session.id, change);
	return result.status === 200
		? new Response(null, { status: 204 })
		: Response.json(result.body, { status: result.status });
};

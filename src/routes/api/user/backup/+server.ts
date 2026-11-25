import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ORIGIN } from '$app/env/private';
import { backupResponse } from '#lib/server/backup.js';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';

export const prerender = false;

const allowed = rateLimiter(20, 60 * 60 * 1000);

/** Downloads the user's backup: a zip of all their data on the server, still encrypted. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!allowed(locals.user.id)) throw error(429, 'Too many backups, try again later');
	return backupResponse(locals.user.id, ORIGIN ?? null);
};

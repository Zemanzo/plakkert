import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BACKUP_CHUNK_BYTES } from '#lib/backup.js';
import { startUpload } from '#lib/server/backupTransfers.js';
import { rateLimiter } from '#lib/server/mcp/rateLimit.js';

const allowed = rateLimiter(20, 60 * 60 * 1000);

/**
 * Starts uploading a backup to restore. The app sends it in pieces to
 * `/api/backup/uploads/[token]`, then restores it with `/api/user/backup/restore`.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!allowed(locals.user.id)) throw error(429, 'Too many uploads, try again later');
	return Response.json({ token: startUpload(locals.user.id), chunkSize: BACKUP_CHUNK_BYTES });
};

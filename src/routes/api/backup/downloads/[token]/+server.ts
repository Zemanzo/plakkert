import type { RequestHandler } from './$types';
import { ORIGIN } from '$app/env/private';
import { backupResponse } from '#lib/server/backup.js';
import { findDownload } from '#lib/server/backupTransfers.js';

export const prerender = false;

/**
 * Downloads a user's backup by a link from `export_backup`, for MCP clients. The token in the link
 * is what allows it. The backup is made now, so it has everything up to this moment.
 */
export const GET: RequestHandler = async ({ params }) => {
	const userId = findDownload(params.token);
	if (!userId) {
		return Response.json({ message: 'No such download, or it expired' }, { status: 404 });
	}
	return backupResponse(userId, ORIGIN ?? null);
};

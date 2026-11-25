import type { RequestHandler } from './$types';
import { appendUpload } from '#lib/server/backupTransfers.js';

/**
 * Adds a piece of a backup that's being uploaded, at `?offset=`, the number of bytes sent before
 * it. The token in the link is what allows it, so MCP clients can upload with their own tools.
 */
export const PUT: RequestHandler = async ({ params, request, url }) => {
	const offset = Number(url.searchParams.get('offset') ?? '0');
	if (!Number.isSafeInteger(offset) || offset < 0) {
		return Response.json({ message: 'offset must be a whole number' }, { status: 400 });
	}

	const result = appendUpload(params.token, offset, Buffer.from(await request.arrayBuffer()));
	switch (result.status) {
		case 200:
			return Response.json({ size: result.size });
		case 404:
			return Response.json({ message: 'No such upload, or it expired' }, { status: 404 });
		case 409:
			return Response.json(
				{ message: `Expected offset ${result.size}`, size: result.size },
				{ status: 409 }
			);
		case 413:
			return Response.json({ message: result.message }, { status: 413 });
	}
};

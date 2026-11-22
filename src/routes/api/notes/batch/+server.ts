import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import {
	deleteNote,
	writeNote,
	writeResultJson,
	writeTags,
	type WriteResult
} from '#lib/server/notes.js';
import { storeVersion } from '#lib/server/history.js';

/** So one request can't keep the database busy for long. */
const MAX_BATCH_SIZE = 100;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const outcome = (result: WriteResult) => ({ status: result.status, body: writeResultJson(result) });

/**
 * Writes several notes and tags at once, which is much faster than a request
 * for each, e.g. after importing hundreds of notes. Each item is the body of a
 * single note PUT (`note`) and/or tags PUT (`tags`), and each gets the status
 * and body those would respond with. The note is written before its tags, so
 * a new note can be sent along with its tags. With `delete: true`, the note is
 * deleted instead, as by a note DELETE (`deleted`). Items can also carry `versions` of the note
 * that the device kept for its history (see `storeVersion`), and get a status for each.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	const items = isObject(body) ? body.notes : undefined;
	if (!Array.isArray(items)) throw error(400, 'notes is required');
	if (items.length > MAX_BATCH_SIZE) throw error(413, `At most ${MAX_BATCH_SIZE} notes at once`);
	if (!items.every((item) => isObject(item) && typeof item.id === 'string')) {
		throw error(400, 'Every note needs an id');
	}

	const results = db.transaction((tx) =>
		(items as Record<string, unknown>[]).map(({ id, note, tags, versions, delete: remove }) => ({
			id,
			...(remove === true && {
				deleted: { status: deleteNote(tx, userId, id as string).status, body: null }
			}),
			...(isObject(note) && { note: outcome(writeNote(tx, userId, id as string, note)) }),
			...(isObject(tags) && { tags: outcome(writeTags(tx, userId, id as string, tags)) }),
			...(Array.isArray(versions) && {
				versions: versions.map((version: unknown) => ({
					status: isObject(version) ? storeVersion(tx, userId, id as string, version) : 400
				}))
			})
		}))
	);

	return Response.json({ results });
};

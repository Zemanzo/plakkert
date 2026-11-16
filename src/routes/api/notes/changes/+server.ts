import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { changeStamp, selectUserNoteIds, selectUserNotes, toNoteJson } from '#lib/server/notes.js';
import { selectSettings } from '#lib/server/settings.js';

/**
 * Lists what changed in the user's notes since `since`, a `cursor` from an
 * earlier response, or all notes without it. Deleted notes are listed as
 * tombstones. Since notes that were unshared can't be listed, it also returns
 * the ids of all notes the user still has. The user's settings come along
 * when they changed (or are null).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	const sinceParam = url.searchParams.get('since');
	const since = sinceParam === null ? null : Number(sinceParam);
	if (since !== null && !Number.isSafeInteger(since)) throw error(400, 'Invalid since');

	// Reading in one (synchronous) transaction means no write can happen in between, so every
	// change after this point gets a stamp of at least the cursor. Changes at exactly the cursor
	// are listed again next time, which is harmless.
	const result = db.transaction((tx) => {
		const cursor = changeStamp();
		const rows = selectUserNotes(
			userId,
			since === null ? undefined : { changedSince: since },
			tx
		).all();
		return {
			cursor,
			notes: rows.map(toNoteJson),
			ids: selectUserNoteIds(userId, tx),
			settings: selectSettings(userId, since, tx)
		};
	});

	return Response.json(result);
};

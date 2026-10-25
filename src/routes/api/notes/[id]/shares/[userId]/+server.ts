import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { notes, user, userNotes } from '#lib/server/db/schema.js';
import { findOwnedNote } from '#lib/server/notes.js';
import { and, eq } from 'drizzle-orm';

const PERMISSIONS = ['view', 'edit'] as const;

/**
 * Shares the note with a user, or changes their permissions. Only the owner
 * can do this. The note key must already be encrypted with the recipient's
 * public key, so the server never sees it.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let body: { noteKey?: unknown; permissions?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	const { noteKey, permissions } = body;
	if (typeof noteKey !== 'string') throw error(400, 'noteKey is required');
	if (!PERMISSIONS.includes(permissions as (typeof PERMISSIONS)[number])) {
		throw error(400, 'permissions must be "view" or "edit"');
	}

	const note = await findOwnedNote(params.id, locals.user.id);
	if (!note) throw error(404, 'Not found');
	if (note.deletedAt) throw error(410, 'Gone');
	if (params.userId === locals.user.id) throw error(400, 'You already own this note');

	const [recipient] = await db.select({ id: user.id }).from(user).where(eq(user.id, params.userId));
	if (!recipient) throw error(404, 'User not found');

	await db
		.insert(userNotes)
		.values({
			userId: recipient.id,
			noteId: params.id,
			noteKey,
			permissions: permissions as (typeof PERMISSIONS)[number]
		})
		.onConflictDoUpdate({
			target: [userNotes.userId, userNotes.noteId],
			set: { noteKey, permissions: permissions as (typeof PERMISSIONS)[number] }
		});

	return new Response(null, { status: 204 });
};

/**
 * Stops sharing the note with a user. The owner can remove anyone else, and a
 * user can remove a note that was shared with them from their own notes.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const [note] = await db.select({ owner: notes.owner }).from(notes).where(eq(notes.id, params.id));
	if (!note) throw error(404, 'Not found');

	const isOwner = note.owner === locals.user.id;
	const isSelf = params.userId === locals.user.id;
	if (isOwner && isSelf) throw error(400, 'The owner can delete the note instead');
	if (!isOwner && !isSelf) throw error(404, 'Not found');

	await db
		.delete(userNotes)
		.where(and(eq(userNotes.noteId, params.id), eq(userNotes.userId, params.userId)));

	return new Response(null, { status: 204 });
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { notes, userNotes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const results = await db
		.select({
			id: notes.id,
			content: notes.content,
			noteKey: userNotes.noteKey,
			permissions: userNotes.permissions,
			createdAt: notes.createdAt,
			updatedAt: notes.updatedAt
		})
		.from(userNotes)
		.innerJoin(notes, eq(userNotes.noteId, notes.id))
		.where(eq(userNotes.userId, locals.user.id));

	return json(
		results.map((r) => ({
			...r,
			content: r.content ? (r.content as Buffer).toString('base64') : null
		}))
	);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let body: { content?: unknown; noteKey?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const { content, noteKey } = body;
	if (typeof content !== 'string' || typeof noteKey !== 'string') {
		throw error(400, 'content and noteKey are required strings');
	}

	const contentBuffer = Buffer.from(content, 'base64');

	const [note] = await db
		.insert(notes)
		.values({ owner: locals.user.id, content: contentBuffer })
		.returning({ id: notes.id, createdAt: notes.createdAt, updatedAt: notes.updatedAt });

	await db.insert(userNotes).values({
		userId: locals.user.id,
		noteId: note.id,
		noteKey,
		permissions: 'edit'
	});

	return json(note, { status: 201 });
};

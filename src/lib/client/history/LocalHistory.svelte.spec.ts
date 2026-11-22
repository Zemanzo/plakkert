import { describe, expect, it, vi } from 'vitest';
import { SESSION_GAP_MS } from '#lib/history.js';
import { db, type Note } from '../Database';
import {
	forgetOtherHistory,
	forgetUserHistory,
	getLocalVersions,
	getUnsentVersions,
	historyTables,
	keepVersion,
	markVersionsSent
} from './LocalHistory';

// Only SvelteKit provides this, and the database is named after it.
vi.mock('$app/env/public', () => ({ PUBLIC_APP_NAME: 'plakkert-test' }));

const SINCE = 1_000;

/** A user who keeps history, with a note of theirs last changed at `updatedAt`. */
async function setUp(updatedAt: Date, historySince: number | null = SINCE) {
	const userId = crypto.randomUUID();
	await db.syncState.put({ userId, cursor: 0, historySince });
	const note: Note<Uint8Array> = {
		id: crypto.randomUUID(),
		ownerId: userId,
		data: new Uint8Array([1, 2, 3]),
		createdAt: new Date(updatedAt.getTime() - 60_000),
		updatedAt,
		dirty: 0
	};
	await db.notes.put(note);
	return { userId, note };
}

const keep = (note: Note<Uint8Array>, userId: string, at: Date, mode?: 'auto' | 'always') =>
	db.transaction('rw', [db.noteKeys, ...historyTables], async () =>
		keepVersion(note, userId, at, mode)
	);

describe('keepVersion', () => {
	it('keeps the note as it was before a session of editing, to send to the server', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - SESSION_GAP_MS));
		expect(await keep(note, userId, new Date())).toBe(true);
		const [version] = await getLocalVersions(userId, note.id);
		expect(version).toMatchObject({ updatedAt: note.updatedAt, since: SINCE, unsent: 1 });
		expect(version.data).toEqual(note.data);
		expect(await getUnsentVersions(userId)).toHaveLength(1);
		// Once is enough.
		expect(await keep(note, userId, new Date(), 'always')).toBe(false);
	});

	it('doesn’t keep every save while typing, unless asked to', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - 1000));
		expect(await keep(note, userId, new Date())).toBe(false);
		expect(await keep(note, userId, new Date(), 'always')).toBe(true);
	});

	it('keeps nothing when the user doesn’t keep history', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - SESSION_GAP_MS), null);
		expect(await keep(note, userId, new Date(), 'always')).toBe(false);
		expect(await getLocalVersions(userId, note.id)).toEqual([]);
	});

	it('follows the owner’s setting for notes shared with the user', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - SESSION_GAP_MS));
		const shared = { ...note, ownerId: 'someone else', historySince: null };
		expect(await keep(shared, userId, new Date(), 'always')).toBe(false);
		expect(await keep({ ...shared, historySince: 5 }, userId, new Date(), 'always')).toBe(true);
		expect((await getLocalVersions(userId, note.id))[0].since).toBe(5);
	});
});

describe('forgetting history', () => {
	it('deletes versions from before history was turned off', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - SESSION_GAP_MS));
		await keep(note, userId, new Date());
		await forgetOtherHistory(note.id, SINCE);
		expect(await getLocalVersions(userId, note.id)).toHaveLength(1);
		await forgetOtherHistory(note.id, SINCE + 1);
		expect(await getLocalVersions(userId, note.id)).toEqual([]);
	});

	it('deletes all of a user’s versions, and versions are sent only once', async () => {
		const { userId, note } = await setUp(new Date(Date.now() - SESSION_GAP_MS));
		await keep(note, userId, new Date());
		await markVersionsSent(await getUnsentVersions(userId));
		expect(await getUnsentVersions(userId)).toEqual([]);
		await forgetUserHistory(userId);
		expect(await getLocalVersions(userId, note.id)).toEqual([]);
	});
});

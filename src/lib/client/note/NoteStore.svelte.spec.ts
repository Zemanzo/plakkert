import { describe, expect, it, vi } from 'vitest';
import type { RuntimeUser } from '#lib/types.js';
import { generateUserKeys } from '../serialization/Serialize';
import { createNotes, updateNoteData } from './NotesCRUD';
import { NoteStore } from './NoteStore.svelte';

// Only SvelteKit provides this, and the database is named after it.
vi.mock('$app/env/public', () => ({ PUBLIC_APP_NAME: 'plakkert-test' }));

async function makeUser(): Promise<RuntimeUser> {
	const { publicKey, privateKey } = await generateUserKeys();
	return {
		id: crypto.randomUUID(),
		publicKeyUint8: publicKey,
		decodedPrivateKey: privateKey
	} as RuntimeUser;
}

/** Waits until the store's entries pass the check. */
async function entriesWhere(
	store: NoteStore,
	check: (entries: NonNullable<NoteStore['entries']>) => boolean
) {
	await expect.poll(() => store.entries && check(store.entries)).toBe(true);
	return store.entries!;
}

describe('NoteStore', () => {
	it('keeps the entries of notes that didn’t change, so only changed notes are updated', async () => {
		const user = await makeUser();
		const meta = { color: 'yellow' };
		const [changedId] = await createNotes(user, [
			{ data: { content: '<p>Changes</p>', meta } },
			{ data: { content: '<p>Stays</p>', meta } }
		]);
		const store = new NoteStore(user);
		const stop = store.start();

		const before = await entriesWhere(store, (entries) => entries.length === 2);
		const changed = before.find((entry) => entry.note.id === changedId)!;
		const unchanged = before.find((entry) => entry.note.id !== changedId)!;

		await updateNoteData(changedId, { content: '<p>Changed</p>', meta }, changed.noteKey);
		const after = await entriesWhere(store, (entries) =>
			entries.some((entry) => entry.note.data.content === '<p>Changed</p>')
		);

		expect(after.find((entry) => entry.note.id === changedId)).not.toBe(changed);
		expect(after.find((entry) => entry.note.id === unchanged.note.id)).toBe(unchanged);
		stop();
	});
});

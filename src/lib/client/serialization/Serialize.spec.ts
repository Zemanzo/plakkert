import { describe, expect, it } from 'vitest';
import { decryptTags, encryptTags, generateUserKeys, getNoteKey } from './Serialize';

describe('tag encryption', () => {
	it('round-trips tags with the note key', async () => {
		const { publicKey } = await generateUserKeys();
		const { noteKey } = await getNoteKey(publicKey);
		const tags = { work: 1, $archived: 2 };

		const encrypted = await encryptTags(tags, noteKey);

		expect(new TextDecoder().decode(encrypted)).not.toContain('work');
		expect(await decryptTags(encrypted, noteKey)).toEqual(tags);
	});

	it('fails with another note key', async () => {
		const { publicKey } = await generateUserKeys();
		const { noteKey } = await getNoteKey(publicKey);
		const { noteKey: otherKey } = await getNoteKey(publicKey);

		const encrypted = await encryptTags({ work: 1 }, noteKey);

		await expect(decryptTags(encrypted, otherKey)).rejects.toThrow();
	});
});

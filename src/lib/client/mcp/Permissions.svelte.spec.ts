import { describe, expect, it } from 'vitest';
import { MAX_FILTER_TAGS } from '#lib/mcp.js';
import { generateUserKeys } from '../serialization/Serialize';
import { openTagFilter, sealTagFilter } from './Permissions';

// In the browser, for its base64 functions of Uint8Array.

describe('tag filters, sealed and opened', () => {
	it('keep their tags', async () => {
		const keys = await generateUserKeys();
		const sealed = await sealTagFilter(['Work', 'Home'], keys.publicKey);
		expect(await openTagFilter(sealed, keys)).toEqual(['Work', 'Home']);
		expect(await sealTagFilter([], keys.publicKey)).toBeNull();
		expect(await openTagFilter(null, keys)).toEqual([]);
	});

	it('can’t have more tags than the server can use', async () => {
		const keys = await generateUserKeys();
		const tags = Array.from({ length: MAX_FILTER_TAGS + 1 }, (_, i) => `Tag ${i}`);
		await expect(sealTagFilter(tags, keys.publicKey)).rejects.toThrow();
	});

	it('are unreadable, not empty, when they can’t be decrypted', async () => {
		const keys = await generateUserKeys();
		const others = await generateUserKeys();
		const sealed = await sealTagFilter(['Private'], others.publicKey);
		expect(await openTagFilter(sealed, keys)).toBeNull();
	});
});

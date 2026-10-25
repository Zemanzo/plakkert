import { describe, expect, it } from 'vitest';
import {
	decryptPrivateKey,
	deriveAuthKey,
	encodeKey,
	encryptPrivateKey,
	LEGACY_KDF_ITERATIONS
} from './PrivateKey';

const privateKey = crypto.getRandomValues(new Uint8Array(32));

describe('encryptPrivateKey / decryptPrivateKey', () => {
	it('round-trips with the right password', async () => {
		const { encryptedKey, salt, nonce, iterations } = await encryptPrivateKey(privateKey, 'secret');

		expect(encryptedKey).not.toEqual(privateKey);
		await expect(
			decryptPrivateKey(encryptedKey, 'secret', salt, nonce, iterations)
		).resolves.toEqual(privateKey);
	});

	it('rejects a wrong password', async () => {
		const { encryptedKey, salt, nonce, iterations } = await encryptPrivateKey(privateKey, 'secret');

		await expect(
			decryptPrivateKey(encryptedKey, 'wrong', salt, nonce, iterations)
		).rejects.toThrow();
	});

	it('needs the iteration count it was encrypted with', async () => {
		const { encryptedKey, salt, nonce } = await encryptPrivateKey(
			privateKey,
			'secret',
			LEGACY_KDF_ITERATIONS
		);

		await expect(
			decryptPrivateKey(encryptedKey, 'secret', salt, nonce, LEGACY_KDF_ITERATIONS)
		).resolves.toEqual(privateKey);
		await expect(
			decryptPrivateKey(encryptedKey, 'secret', salt, nonce, LEGACY_KDF_ITERATIONS + 1)
		).rejects.toThrow();
	});

	it('accepts keys that are views into a larger buffer', async () => {
		const view = new Uint8Array(64).subarray(16, 48);
		view.set(privateKey);
		const { encryptedKey, salt, nonce, iterations } = await encryptPrivateKey(view, 'secret');

		await expect(
			decryptPrivateKey(encryptedKey, 'secret', salt, nonce, iterations)
		).resolves.toEqual(privateKey);
	});
});

describe('deriveAuthKey', () => {
	it('is deterministic for a password and username', async () => {
		expect(await deriveAuthKey('secret', 'alice')).toBe(await deriveAuthKey('secret', 'alice'));
	});

	it('depends on the username and the password', async () => {
		const key = await deriveAuthKey('secret', 'alice');

		expect(await deriveAuthKey('secret', 'bob')).not.toBe(key);
		expect(await deriveAuthKey('other', 'alice')).not.toBe(key);
	});

	it('does not reveal the password', async () => {
		const key = await deriveAuthKey('secret', 'alice');

		expect(key).not.toContain('secret');
		expect(key).not.toBe(encodeKey(new TextEncoder().encode('secret')));
		expect(key).toHaveLength(44); // 32 bytes, base64 encoded
	});
});

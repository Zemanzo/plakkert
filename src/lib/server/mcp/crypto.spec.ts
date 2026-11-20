import _sodium from 'libsodium-wrappers';
import { describe, expect, it } from 'vitest';
import { WRAP_KEY_CONTEXT } from '#lib/mcp.js';
import { parseSecretToken, randomToken, sameHash, sha256, unwrapPrivateKey } from './crypto';

/** Encrypts a private key like the app does for a grant (`src/lib/client/mcp/Grant.ts`). */
async function wrap(privateKey: Uint8Array, secret: Uint8Array) {
	await _sodium.ready;
	const s = _sodium;
	const key = s.crypto_generichash(s.crypto_secretbox_KEYBYTES, WRAP_KEY_CONTEXT, secret);
	const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
	return new Uint8Array([...nonce, ...s.crypto_secretbox_easy(privateKey, nonce, key)]);
}

describe('grant keys', () => {
	it('can only be unwrapped with the grant’s secret, and must be the user’s', async () => {
		await _sodium.ready;
		const user = _sodium.crypto_box_keypair();
		const other = _sodium.crypto_box_keypair();
		const secret = _sodium.randombytes_buf(32);
		const wrapped = await wrap(user.privateKey, secret);

		expect(await unwrapPrivateKey(wrapped, secret, user.publicKey)).toEqual(user.privateKey);
		expect(await unwrapPrivateKey(wrapped, _sodium.randombytes_buf(32), user.publicKey)).toBeNull();
		// Someone else's key, even when it decrypts, isn't accepted for this user.
		const wrappedOther = await wrap(other.privateKey, secret);
		expect(await unwrapPrivateKey(wrappedOther, secret, user.publicKey)).toBeNull();
		expect(await unwrapPrivateKey(new Uint8Array(10), secret, user.publicKey)).toBeNull();
	});
});

describe('tokens', () => {
	it('are an id and a 32-byte secret', () => {
		const token = `${randomToken(16)}.${randomToken(32)}`;
		const parsed = parseSecretToken(token);
		expect(parsed?.id).toBe(token.split('.')[0]);
		expect(parsed?.secret).toHaveLength(32);
		expect(parseSecretToken(`${token}x`)).toBeNull();
		expect(parseSecretToken('a.b')).toBeNull();
		expect(parseSecretToken(`${randomToken(16)}.${randomToken(32)}.x`)).toBeNull();
	});

	it('are compared by hash', () => {
		expect(sameHash(sha256('a'), sha256('a'))).toBe(true);
		expect(sameHash(sha256('a'), sha256('b'))).toBe(false);
		expect(sameHash(sha256('a'), 'short')).toBe(false);
	});
});

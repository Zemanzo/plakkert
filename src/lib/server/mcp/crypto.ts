import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import _sodium from 'libsodium-wrappers';
import { WRAP_KEY_CONTEXT } from '#lib/mcp.js';

// Cryptography for MCP access, on the server. Notes stay encrypted as always; they're only
// decrypted while an MCP client with a valid token asks for them, with the user's private key as
// unwrapped with the secret in that token. See `oauthGrants` in the schema.

async function sodium() {
	await _sodium.ready;
	return _sodium;
}

/** A random identifier or secret, as base64url without padding: safe in URLs and headers. */
export const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/** Compares two hashes in constant time, so the time taken doesn't tell how much matched. */
export function sameHash(a: string, b: string) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Splits a code or token, `<id>.<secret>`, where the secret is 32 random bytes. Returns null for
 * anything else, so malformed input is rejected before it gets near the database.
 */
export function parseSecretToken(token: string) {
	const match = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
	if (!match) return null;
	const secret = Buffer.from(match[2], 'base64url');
	return secret.length === 32 ? { id: match[1], secret: new Uint8Array(secret) } : null;
}

/**
 * Decrypts the user's private key that their browser encrypted for a grant (see
 * `src/lib/client/mcp/Grant.ts`), and checks that it belongs to their public key.
 *
 * @returns The private key, or null if the secret doesn't fit or the key isn't theirs.
 */
export async function unwrapPrivateKey(
	wrappedKey: Uint8Array,
	secret: Uint8Array,
	publicKey: Uint8Array
) {
	const s = await sodium();
	const nonceBytes = s.crypto_secretbox_NONCEBYTES;
	if (wrappedKey.length <= nonceBytes) return null;
	const key = s.crypto_generichash(s.crypto_secretbox_KEYBYTES, WRAP_KEY_CONTEXT, secret);
	try {
		const privateKey = s.crypto_secretbox_open_easy(
			wrappedKey.slice(nonceBytes),
			wrappedKey.slice(0, nonceBytes),
			key
		);
		const derived = s.crypto_scalarmult_base(privateKey);
		if (derived.length !== publicKey.length || !timingSafeEqual(derived, publicKey)) {
			s.memzero(privateKey);
			return null;
		}
		return privateKey;
	} catch {
		return null;
	} finally {
		s.memzero(key);
	}
}

/** Clears a private key from memory once it's no longer needed. */
export async function forget(privateKey: Uint8Array) {
	(await sodium()).memzero(privateKey);
}

/** Decrypts a note key that was sealed to the user's public key, like the app does. */
export async function openNoteKey(
	sealedKey: Uint8Array,
	publicKey: Uint8Array,
	privateKey: Uint8Array
) {
	return (await sodium()).crypto_box_seal_open(sealedKey, publicKey, privateKey);
}

/** Decrypts JSON encrypted with a note key, like the app does (nonce first, then ciphertext). */
export async function decryptJson(encrypted: Uint8Array, noteKey: Uint8Array): Promise<unknown> {
	const s = await sodium();
	const nonceBytes = s.crypto_secretbox_NONCEBYTES;
	const plain = s.crypto_secretbox_open_easy(
		encrypted.slice(nonceBytes),
		encrypted.slice(0, nonceBytes),
		noteKey
	);
	return JSON.parse(s.to_string(plain));
}

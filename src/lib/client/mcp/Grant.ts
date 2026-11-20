import _sodium from 'libsodium-wrappers';
import { WRAP_KEY_CONTEXT } from '#lib/mcp.js';

// Approving an MCP client: the browser encrypts the user's private key with a new secret, which
// only the client gets, inside its authorization code. The server keeps the encrypted key, and
// can only decrypt notes while the client asks, with that secret. See `oauthGrants`.

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const toBase64Url = (bytes: Uint8Array) =>
	toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Base64Url(text: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return toBase64Url(new Uint8Array(digest));
}

/**
 * Encrypts the private key for a new grant.
 *
 * @returns The encrypted key and the secret's hash, for the server, and the secret itself, which
 *   only goes into the code for the client.
 */
export async function wrapKeyForGrant(privateKey: Uint8Array) {
	await _sodium.ready;
	const sodium = _sodium;
	const secret = sodium.randombytes_buf(32);
	const key = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, WRAP_KEY_CONTEXT, secret);
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const ciphertext = sodium.crypto_secretbox_easy(privateKey, nonce, key);
	sodium.memzero(key);
	const wrapped = new Uint8Array(nonce.length + ciphertext.length);
	wrapped.set(nonce);
	wrapped.set(ciphertext, nonce.length);
	const encodedSecret = toBase64Url(secret);
	sodium.memzero(secret);
	return {
		wrappedKey: toBase64(wrapped),
		secret: encodedSecret,
		secretHash: await sha256Base64Url(encodedSecret)
	};
}

/**
 * The address to send the user back to the client with: its redirect URI, with the result added
 * to the query, along with `iss`, so the client can tell which server answered (RFC 9207).
 */
export function clientRedirect(redirectUri: string, params: Record<string, string | null>) {
	const url = new URL(redirectUri);
	for (const [name, value] of Object.entries(params)) {
		if (value !== null) url.searchParams.set(name, value);
	}
	return url.href;
}

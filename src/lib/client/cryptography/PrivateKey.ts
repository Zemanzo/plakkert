/** PBKDF2 iterations for keys derived from the password, as recommended by OWASP for SHA-256. */
export const KDF_ITERATIONS = 600_000;
/** PBKDF2 iterations used by accounts created before {@link KDF_ITERATIONS} was raised. */
export const LEGACY_KDF_ITERATIONS = 100_000;

/** Prefix of the salt for the auth key, so it never matches a key derived for another purpose. */
const AUTH_KEY_SALT_PREFIX = 'plakkert-auth:';

/** Copies into a Uint8Array that owns its whole buffer, as WebCrypto reads the entire view. */
function bytes(data: Uint8Array) {
	return new Uint8Array(data);
}

function importPassword(password: string) {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
		'deriveKey',
		'deriveBits'
	]);
}

/**
 * Derives the secret that is sent to the server instead of the password. The
 * server only ever sees this value, so it can't use it to decrypt the private
 * key, which is encrypted with a key derived using a different (random) salt.
 *
 * @param username The normalized username, which acts as the salt.
 */
export async function deriveAuthKey(password: string, username: string) {
	const authKey = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: new TextEncoder().encode(AUTH_KEY_SALT_PREFIX + username),
			iterations: KDF_ITERATIONS,
			hash: 'SHA-256'
		},
		await importPassword(password),
		256
	);
	return encodeKey(new Uint8Array(authKey));
}

/** Derives the AES key that the private key is encrypted with. */
async function deriveKeyEncryptionKey(
	password: string,
	salt: Uint8Array,
	iterations: number,
	usage: KeyUsage
) {
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' },
		await importPassword(password),
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage]
	);
}

export async function encryptPrivateKey(
	privateKey: Uint8Array,
	password: string,
	iterations = KDF_ITERATIONS
) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const derivedKey = await deriveKeyEncryptionKey(password, salt, iterations, 'encrypt');

	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const encryptedKey = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		derivedKey,
		bytes(privateKey)
	);

	return { encryptedKey: new Uint8Array(encryptedKey), salt, nonce, iterations };
}

/** Decrypts the private key. Rejects if the password is wrong. */
export async function decryptPrivateKey(
	encryptedKey: Uint8Array,
	password: string,
	salt: Uint8Array,
	nonce: Uint8Array,
	iterations: number
) {
	const derivedKey = await deriveKeyEncryptionKey(password, salt, iterations, 'decrypt');
	const decryptedKeyBuffer = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: bytes(nonce) },
		derivedKey,
		bytes(encryptedKey)
	);
	return new Uint8Array(decryptedKeyBuffer);
}

/**
 * Utility function to encode a Uint8Array private key into a base64 string for storage.
 */
export function encodeKey(privateKey: Uint8Array) {
	return btoa(String.fromCharCode(...privateKey));
}

/**
 * Utility function to decode a base64-encoded private key string into a Uint8Array.
 */
export function decodeKey(encodedKey: string) {
	return Uint8Array.from(atob(encodedKey), (c) => c.charCodeAt(0));
}

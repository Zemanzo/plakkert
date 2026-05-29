export async function encryptPrivateKey(privateKey: Uint8Array, password: string) {
	// 1. Generate a random salt
	const salt = crypto.getRandomValues(new Uint8Array(16));

	// 2. Derive a 32-byte key from the password using PBKDF2
	const passwordBuffer = new TextEncoder().encode(password);
	const baseKey = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
		'deriveKey',
		'deriveBits'
	]);
	const passwordHash = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			iterations: 100_000,
			hash: 'SHA-256'
		},
		baseKey,
		256
	);
	const derivedKey = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: 100_000,
			hash: 'SHA-256'
		},
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt']
	);

	// 3. Encrypt the private key
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const encryptedKey = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		derivedKey,
		privateKey!.buffer as ArrayBuffer
	);

	return { encryptedKey: new Uint8Array(encryptedKey), salt, nonce, passwordHash };
}

export async function decryptPrivateKey(
	privateKey: Uint8Array,
	password: string,
	salt: Uint8Array,
	nonce: Uint8Array
) {
	const baseKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	);
	const derivedKey = await crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt']
	);
	const decryptedKeyBuffer = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
		derivedKey,
		privateKey.buffer as ArrayBuffer
	);
	return decryptedKeyBuffer;
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

export function sessionStorePrivateKey(key: Uint8Array): void {
	sessionStorage.setItem('privateKey', encodeKey(key));
}

export function sessionGetPrivateKey(): Uint8Array | null {
	const encodedKey = sessionStorage.getItem('privateKey');
	if (!encodedKey) return null;
	return decodeKey(encodedKey);
}

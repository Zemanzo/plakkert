import _sodium from 'libsodium-wrappers';

async function initCrypto() {
	// Always wait for the WASM binary to load completely
	await _sodium.ready;
	return _sodium;
}

export async function getNoteKey(publicKey: Uint8Array) {
	const sodium = await initCrypto();

	const noteKey = sodium.crypto_secretbox_keygen();

	const encryptedKey = sodium.crypto_box_seal(noteKey, publicKey);

	return { noteKey, encryptedKey };
}

export async function decryptNoteKey(
	encryptedKey: Uint8Array,
	publicKey: Uint8Array,
	privateKey: Uint8Array
) {
	const sodium = await initCrypto();

	return sodium.crypto_box_seal_open(encryptedKey, publicKey, privateKey);
}

export async function encryptNote(note: string, noteKey: Uint8Array) {
	const sodium = await initCrypto();

	// 2. Generate a random unique nonce (24 bytes)
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

	// 3. Scramble the text string using the key and nonce
	const encryptedRaw = sodium.crypto_secretbox_easy(note, nonce, noteKey);

	// 4. Combine the nonce + encrypted message into one single package.
	// This is a standard security practice because the recipient needs the nonce to decrypt.
	const combinedPayload = new Uint8Array(nonce.length + encryptedRaw.length);
	combinedPayload.set(nonce);
	combinedPayload.set(encryptedRaw, nonce.length);

	return {
		encryptedData: combinedPayload
	};
}

export async function decryptNote(
	encryptedData: Uint8Array,
	encryptedNoteKey: Uint8Array,
	privateKey: Uint8Array,
	publicKey: string
) {
	const sodium = await initCrypto();

	const publicKeyBytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));

	// Step 1: Open the sealed box using your keys to get the raw Note Key back
	const decryptedNoteKey = sodium.crypto_box_seal_open(
		encryptedNoteKey,
		publicKeyBytes,
		privateKey
	);

	// Step 2: Extract the nonce from the front of the main note payload
	const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
	const nonce = encryptedData.slice(0, nonceBytes);
	const ciphertext = encryptedData.slice(nonceBytes);

	// Step 3: Unscramble the actual text of the note back into plaintext
	const decryptedNoteRaw = sodium.crypto_secretbox_open_easy(ciphertext, nonce, decryptedNoteKey);

	// Step 4: Convert binary back to readable text string
	return sodium.to_string(decryptedNoteRaw);
}

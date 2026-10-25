import _sodium from 'libsodium-wrappers';
import type { Note } from '../Database';

async function initCrypto() {
	// Always wait for the WASM binary to load completely
	await _sodium.ready;
	return _sodium;
}

/** Generates the asymmetric key pair that note keys are encrypted with. */
export async function generateUserKeys() {
	const sodium = await initCrypto();

	const { publicKey, privateKey } = sodium.crypto_box_keypair();

	return { publicKey, privateKey };
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

export async function encryptNote(data: Note['data'], noteKey: Uint8Array) {
	const sodium = await initCrypto();
	const stringData = JSON.stringify(data);
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const encryptedRaw = sodium.crypto_secretbox_easy(stringData, nonce, noteKey);
	const combinedPayload = new Uint8Array(nonce.length + encryptedRaw.length);
	combinedPayload.set(nonce);
	combinedPayload.set(encryptedRaw, nonce.length);

	return {
		encryptedData: combinedPayload
	};
}

/** Decrypts note data that was encrypted with {@link encryptNote}. */
export async function decryptNoteData(encryptedData: Uint8Array, noteKey: Uint8Array) {
	const sodium = await initCrypto();

	const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
	const nonce = encryptedData.slice(0, nonceBytes);
	const ciphertext = encryptedData.slice(nonceBytes);
	const decryptedNoteRaw = sodium.crypto_secretbox_open_easy(ciphertext, nonce, noteKey);

	const data = sodium.to_string(decryptedNoteRaw);

	try {
		const parsedData = JSON.parse(data) as Note['data'];
		return parsedData;
	} catch (error) {
		throw new Error('Failed to parse decrypted note data', { cause: error });
	}
}

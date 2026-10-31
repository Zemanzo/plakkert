import _sodium from 'libsodium-wrappers';
import type { Note } from '../Database';
import { parseTags, type NoteTags } from '../tags/Tags';

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

	const encryptedKey = await sealNoteKey(noteKey, publicKey);

	return { noteKey, encryptedKey };
}

/** Encrypts a note key so that only the owner of the given public key can decrypt it. */
export async function sealNoteKey(noteKey: Uint8Array, publicKey: Uint8Array) {
	const sodium = await initCrypto();

	return sodium.crypto_box_seal(noteKey, publicKey);
}

export async function decryptNoteKey(
	encryptedKey: Uint8Array,
	publicKey: Uint8Array,
	privateKey: Uint8Array
) {
	const sodium = await initCrypto();

	return sodium.crypto_box_seal_open(encryptedKey, publicKey, privateKey);
}

/** Encrypts a value as JSON with a note key. The nonce is prepended to the ciphertext. */
async function encryptJson(value: unknown, noteKey: Uint8Array) {
	const sodium = await initCrypto();
	const stringData = JSON.stringify(value);
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const encryptedRaw = sodium.crypto_secretbox_easy(stringData, nonce, noteKey);
	const combinedPayload = new Uint8Array(nonce.length + encryptedRaw.length);
	combinedPayload.set(nonce);
	combinedPayload.set(encryptedRaw, nonce.length);
	return combinedPayload;
}

/** Decrypts a value that was encrypted with {@link encryptJson}. */
async function decryptJson(encryptedData: Uint8Array, noteKey: Uint8Array): Promise<unknown> {
	const sodium = await initCrypto();

	const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
	const nonce = encryptedData.slice(0, nonceBytes);
	const ciphertext = encryptedData.slice(nonceBytes);
	const decryptedRaw = sodium.crypto_secretbox_open_easy(ciphertext, nonce, noteKey);

	const data = sodium.to_string(decryptedRaw);

	try {
		return JSON.parse(data);
	} catch (error) {
		throw new Error('Failed to parse decrypted data', { cause: error });
	}
}

export async function encryptNote(data: Note['data'], noteKey: Uint8Array) {
	return {
		encryptedData: await encryptJson(data, noteKey)
	};
}

/** Decrypts note data that was encrypted with {@link encryptNote}. */
export async function decryptNoteData(encryptedData: Uint8Array, noteKey: Uint8Array) {
	return (await decryptJson(encryptedData, noteKey)) as Note['data'];
}

/** Encrypts a user's tags for a note with the note key, so the server can't read them. */
export async function encryptTags(tags: NoteTags, noteKey: Uint8Array) {
	return encryptJson(tags, noteKey);
}

/** Decrypts tags that were encrypted with {@link encryptTags}. */
export async function decryptTags(encryptedTags: Uint8Array, noteKey: Uint8Array) {
	return parseTags(await decryptJson(encryptedTags, noteKey));
}

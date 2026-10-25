import { db, type User } from '../Database';
import {
	decodeKey,
	decryptPrivateKey,
	encodeKey,
	encryptPrivateKey
} from '../cryptography/PrivateKey';
import { generateUserKeys } from '../serialization/Serialize';
import { defaultPreferences } from '../settings/Preferences';
import {
	fetchServerUser,
	OfflineError,
	signInUsername,
	signOut,
	signUpEmail,
	type ServerUser
} from './AuthApi';
import { clearUnlockedSession, setLastUsername, storeUnlockedSession } from './Session';

/** The server normalizes usernames to lowercase, so we do the same locally. */
export function normalizeUsername(username: string) {
	return username.trim().toLowerCase();
}

/**
 * Stores the user as known by the server in IndexedDB, keeping any local
 * preferences.
 */
async function storeServerUser(serverUser: ServerUser) {
	const existingUser = await db.users.get(serverUser.id);

	const user: User = {
		id: serverUser.id,
		username: serverUser.username,
		email: serverUser.email,
		publicKey: serverUser.publicKey,
		privateKey: decodeKey(serverUser.privateKey),
		salt: decodeKey(serverUser.salt),
		nonce: decodeKey(serverUser.nonce),
		preferences: existingUser?.preferences ?? defaultPreferences
	};

	await db.users.put(user);
	return user;
}

function unlock(user: User, privateKey: Uint8Array) {
	storeUnlockedSession({ userId: user.id, privateKey });
	setLastUsername(user.username);
}

/**
 * Unlocks an account that has been used on this device before, without
 * contacting the server. The password is verified by decrypting the private
 * key.
 */
async function unlockOffline(username: string, password: string) {
	const user = await db.users.where('username').equals(username).first();
	if (!user) {
		throw new Error(
			"You're offline, and this account hasn't been used on this device before. Connect to the internet to log in."
		);
	}

	let privateKey: Uint8Array;
	try {
		privateKey = await decryptPrivateKey(user.privateKey, password, user.salt, user.nonce);
	} catch {
		throw new Error('Invalid username or password');
	}

	unlock(user, privateKey);
	return user;
}

/**
 * Logs in with the server and unlocks the private key. Falls back to unlocking
 * the locally stored account when the server can't be reached.
 */
export async function login(rawUsername: string, password: string) {
	const username = normalizeUsername(rawUsername);

	try {
		await signInUsername(username, password);
	} catch (error) {
		if (error instanceof OfflineError) {
			return unlockOffline(username, password);
		}
		throw error;
	}

	const user = await storeServerUser(await fetchServerUser());
	const privateKey = await decryptPrivateKey(user.privateKey, password, user.salt, user.nonce);
	unlock(user, privateKey);
	return user;
}

/** Creates a new account. This requires a connection to the server. */
export async function register(rawUsername: string, password: string) {
	const username = normalizeUsername(rawUsername);
	const keys = await generateUserKeys();
	const { encryptedKey, salt, nonce } = await encryptPrivateKey(keys.privateKey, password);
	const publicKey = encodeKey(keys.publicKey);
	// Accounts are identified by username, but Better Auth requires a unique email address.
	const email = `${crypto.randomUUID()}@example.com`;

	const response = await signUpEmail({
		email,
		name: '',
		username,
		password,
		publicKey,
		privateKey: encodeKey(encryptedKey),
		salt: encodeKey(salt),
		nonce: encodeKey(nonce)
	});

	const user: User = {
		id: response.user.id,
		username,
		email,
		publicKey,
		privateKey: encryptedKey,
		salt,
		nonce,
		preferences: defaultPreferences
	};
	await db.users.add(user);

	unlock(user, keys.privateKey);
	return user;
}

/**
 * Locks the private key and ends the server session. When offline, the
 * server session simply stays around until it expires.
 */
export async function logout() {
	clearUnlockedSession();
	try {
		await signOut();
	} catch (error) {
		console.warn('Could not end the server session', error);
	}
}

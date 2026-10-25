import { db, type User } from '../Database';
import {
	decodeKey,
	decryptPrivateKey,
	deriveAuthKey,
	encodeKey,
	encryptPrivateKey,
	KDF_ITERATIONS,
	LEGACY_KDF_ITERATIONS
} from '../cryptography/PrivateKey';
import { generateUserKeys } from '../serialization/Serialize';
import { defaultPreferences } from '../settings/Preferences';
import {
	ApiError,
	changePassword,
	fetchServerUser,
	OfflineError,
	signInUsername,
	signOut,
	signUpEmail,
	updateEncryptedPrivateKey,
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
		kdfIterations: serverUser.kdfIterations,
		preferences: existingUser?.preferences ?? defaultPreferences
	};

	await db.users.put(user);
	return user;
}

function unlock(user: User, privateKey: Uint8Array) {
	storeUnlockedSession({ userId: user.id, privateKey });
	setLastUsername(user.username);
}

const kdfIterationsOf = (user: User) => user.kdfIterations ?? LEGACY_KDF_ITERATIONS;

/**
 * Unlocks an account that has been used on this device before, without
 * contacting the server. The password is verified by decrypting the private
 * key.
 */
async function unlockOffline(user: User | undefined, password: string) {
	if (!user) {
		throw new Error(
			"You're offline, and this account hasn't been used on this device before. Connect to the internet to log in."
		);
	}

	let privateKey: Uint8Array;
	try {
		privateKey = await decryptPrivateKey(
			user.privateKey,
			password,
			user.salt,
			user.nonce,
			kdfIterationsOf(user)
		);
	} catch {
		throw new Error('Invalid username or password');
	}

	unlock(user, privateKey);
	return user;
}

/**
 * Signs in with the auth key derived from the password. Accounts created
 * before that still have the password itself as their server password; they
 * are switched over to the auth key on their first login.
 */
async function signIn(username: string, password: string, authKey: string, localUser?: User) {
	try {
		await signInUsername(username, authKey);
		return;
	} catch (error) {
		// Once this device has seen the account migrated, never send the actual password again.
		const isMigrated = localUser && kdfIterationsOf(localUser) >= KDF_ITERATIONS;
		if (isMigrated || !(error instanceof ApiError && error.status === 401)) {
			throw error;
		}
	}

	await signInUsername(username, password);
	await changePassword(password, authKey);
}

/** Re-encrypts the private key with the current (stronger) key derivation settings. */
async function upgradePrivateKeyEncryption(user: User, privateKey: Uint8Array, password: string) {
	const { encryptedKey, salt, nonce, iterations } = await encryptPrivateKey(privateKey, password);
	try {
		await updateEncryptedPrivateKey({
			privateKey: encodeKey(encryptedKey),
			salt: encodeKey(salt),
			nonce: encodeKey(nonce),
			kdfIterations: iterations
		});
	} catch (error) {
		// Not fatal: the old encryption still works, and we'll try again on the next login.
		console.warn('Could not upgrade the private key encryption', error);
		return user;
	}

	const upgradedUser: User = {
		...user,
		privateKey: encryptedKey,
		salt,
		nonce,
		kdfIterations: iterations
	};
	await db.users.put(upgradedUser);
	return upgradedUser;
}

/**
 * Logs in with the server and unlocks the private key. Falls back to unlocking
 * the locally stored account when the server can't be reached.
 */
export async function login(rawUsername: string, password: string) {
	const username = normalizeUsername(rawUsername);
	const localUser = await db.users.where('username').equals(username).first();
	const authKey = await deriveAuthKey(password, username);

	try {
		await signIn(username, password, authKey, localUser);
	} catch (error) {
		if (error instanceof OfflineError) {
			return unlockOffline(localUser, password);
		}
		throw error;
	}

	let user = await storeServerUser(await fetchServerUser());
	const privateKey = await decryptPrivateKey(
		user.privateKey,
		password,
		user.salt,
		user.nonce,
		kdfIterationsOf(user)
	);
	if (kdfIterationsOf(user) < KDF_ITERATIONS) {
		user = await upgradePrivateKeyEncryption(user, privateKey, password);
	}

	unlock(user, privateKey);
	return user;
}

/** Creates a new account. This requires a connection to the server. */
export async function register(rawUsername: string, password: string) {
	const username = normalizeUsername(rawUsername);
	const keys = await generateUserKeys();
	const [{ encryptedKey, salt, nonce, iterations }, authKey] = await Promise.all([
		encryptPrivateKey(keys.privateKey, password),
		deriveAuthKey(password, username)
	]);
	const publicKey = encodeKey(keys.publicKey);
	// Accounts are identified by username, but Better Auth requires a unique email address.
	const email = `${crypto.randomUUID()}@example.com`;

	const response = await signUpEmail({
		email,
		name: '',
		username,
		password: authKey,
		publicKey,
		privateKey: encodeKey(encryptedKey),
		salt: encodeKey(salt),
		nonce: encodeKey(nonce),
		kdfIterations: iterations
	});

	const user: User = {
		id: response.user.id,
		username,
		email,
		publicKey,
		privateKey: encryptedKey,
		salt,
		nonce,
		kdfIterations: iterations,
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

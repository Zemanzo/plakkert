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
import type { BackupManifest } from '#lib/backup.js';
import { generateUserKeys, publicKeyOf } from '../serialization/Serialize';
import { defaultPreferences } from '../settings/Preferences';
import { ApiError, OfflineError } from '../Api';
import { syncEngine } from '../sync/Sync.svelte';
import {
	changePassword,
	changePasswordAndKey,
	fetchServerUser,
	signInUsername,
	signOut,
	signUpEmail,
	type ServerUser
} from './AuthApi';
import {
	clearUnlockedSession,
	getUnlockedSession,
	setLastUsername,
	storeUnlockedSession,
	updateSessionAuthKey
} from './Session';

/** Thrown when changing the password, if the current password that was entered is wrong. */
export class WrongPasswordError extends Error {}

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

function unlock(user: User, privateKey: Uint8Array, authKey: string) {
	storeUnlockedSession({ userId: user.id, privateKey, authKey });
	setLastUsername(user.username);
}

const kdfIterationsOf = (user: User) => user.kdfIterations ?? LEGACY_KDF_ITERATIONS;

/**
 * Unlocks an account that has been used on this device before, without
 * contacting the server. The password is verified by decrypting the private
 * key.
 */
async function unlockOffline(user: User | undefined, password: string, authKey: string) {
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

	unlock(user, privateKey, authKey);
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

/**
 * Re-encrypts the private key with the current (stronger) key derivation settings. The password
 * stays the same, so the server keeps the other sessions.
 */
async function upgradePrivateKeyEncryption(
	user: User,
	privateKey: Uint8Array,
	password: string,
	authKey: string
) {
	const { encryptedKey, salt, nonce, iterations } = await encryptPrivateKey(privateKey, password);
	try {
		await changePasswordAndKey({
			currentAuthKey: authKey,
			newAuthKey: authKey,
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
			return unlockOffline(localUser, password, authKey);
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
		user = await upgradePrivateKeyEncryption(user, privateKey, password, authKey);
	}

	unlock(user, privateKey, authKey);
	return user;
}

/**
 * Creates a new account. This requires a connection to the server.
 *
 * @param inviteCode Needed when registration is invite only.
 */
export async function register(rawUsername: string, password: string, inviteCode?: string) {
	return createAccount(rawUsername, password, inviteCode, await generateUserKeys());
}

/**
 * Creates a new account from a backup, with the backup's key pair, so its notes can be restored
 * into it (see `restoreBackup` in `../backup/Backup`). The password must be the one the backup
 * was made with, as its private key is encrypted with it.
 */
export async function registerFromBackup(
	rawUsername: string,
	password: string,
	inviteCode: string | undefined,
	manifest: BackupManifest
) {
	const { user: backupUser } = manifest;
	let privateKey: Uint8Array;
	try {
		privateKey = await decryptPrivateKey(
			decodeKey(backupUser.privateKey),
			password,
			decodeKey(backupUser.salt),
			decodeKey(backupUser.nonce),
			backupUser.kdfIterations
		);
	} catch {
		throw new WrongPasswordError('That isn’t the password this backup was made with.');
	}
	const publicKey = decodeKey(backupUser.publicKey);
	if (encodeKey(await publicKeyOf(privateKey)) !== encodeKey(publicKey)) {
		throw new Error('This backup is damaged: its keys don’t belong together.');
	}
	return createAccount(rawUsername, password, inviteCode, { publicKey, privateKey });
}

async function createAccount(
	rawUsername: string,
	password: string,
	inviteCode: string | undefined,
	keys: { publicKey: Uint8Array; privateKey: Uint8Array }
) {
	const username = normalizeUsername(rawUsername);
	const [{ encryptedKey, salt, nonce, iterations }, authKey] = await Promise.all([
		encryptPrivateKey(keys.privateKey, password),
		deriveAuthKey(password, username)
	]);
	const publicKey = encodeKey(keys.publicKey);
	// Accounts are identified by username, but Better Auth requires a unique email address.
	const email = `${crypto.randomUUID()}@example.com`;

	const response = await signUpEmail(
		{
			email,
			name: '',
			username,
			password: authKey,
			publicKey,
			privateKey: encodeKey(encryptedKey),
			salt: encodeKey(salt),
			nonce: encodeKey(nonce),
			kdfIterations: iterations
		},
		inviteCode
	);

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

	unlock(user, keys.privateKey, authKey);
	return user;
}

/**
 * Changes the password of the logged-in user. This requires a connection to the server.
 *
 * The private key stays the same, so notes and shares are unaffected; it's only encrypted with
 * the new password instead. The server password, the auth key, changes along with it. Other
 * devices are logged out and have to log in with the new password; this one stays logged in.
 */
export async function changeAccountPassword(currentPassword: string, newPassword: string) {
	const session = getUnlockedSession();
	if (!session) throw new Error('Log in again to change your password.');

	// The server's copy, as this device's may be outdated. Decrypting it checks the password,
	// before anything is sent; the server checks it as well.
	const user = await storeServerUser(await fetchServerUser());
	if (user.id !== session.userId) throw new Error('Log in again to change your password.');
	let privateKey: Uint8Array;
	try {
		privateKey = await decryptPrivateKey(
			user.privateKey,
			currentPassword,
			user.salt,
			user.nonce,
			kdfIterationsOf(user)
		);
	} catch {
		throw new WrongPasswordError('The current password is wrong.');
	}

	const [currentAuthKey, newAuthKey, encrypted] = await Promise.all([
		deriveAuthKey(currentPassword, user.username),
		deriveAuthKey(newPassword, user.username),
		encryptPrivateKey(privateKey, newPassword)
	]);
	try {
		await changePasswordAndKey({
			currentAuthKey,
			newAuthKey,
			privateKey: encodeKey(encrypted.encryptedKey),
			salt: encodeKey(encrypted.salt),
			nonce: encodeKey(encrypted.nonce),
			kdfIterations: encrypted.iterations
		});
	} catch (error) {
		if (error instanceof ApiError && error.code === 'INVALID_PASSWORD') {
			throw new WrongPasswordError('The current password is wrong.');
		}
		throw error;
	}

	await db.users.update(user.id, {
		privateKey: encrypted.encryptedKey,
		salt: encrypted.salt,
		nonce: encrypted.nonce,
		kdfIterations: encrypted.iterations
	});
	updateSessionAuthKey(newAuthKey);
}

/**
 * Locks the private key and ends the server session. When offline, the
 * server session simply stays around until it expires.
 */
export async function logout() {
	syncEngine.stop();
	clearUnlockedSession();
	try {
		await signOut();
	} catch (error) {
		console.warn('Could not end the server session', error);
	}
}

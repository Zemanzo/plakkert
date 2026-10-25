import { decodeKey, encodeKey } from '../cryptography/PrivateKey';

const SESSION_STORAGE_KEY = 'plakkert_session';
const LAST_USERNAME_STORAGE_KEY = 'plakkert_lastUsername';

/**
 * The user whose private key has been unlocked in this tab. Kept in session
 * storage, so it is forgotten when the tab is closed.
 */
export interface UnlockedSession {
	userId: string;
	privateKey: Uint8Array;
	/** Lets the sync engine sign in again when the server session has expired. */
	authKey: string;
}

interface StoredSession {
	userId: string;
	privateKey: string;
	authKey: string;
}

export function getUnlockedSession(): UnlockedSession | null {
	try {
		const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (!stored) return null;
		const { userId, privateKey, authKey } = JSON.parse(stored) as StoredSession;
		return { userId, privateKey: decodeKey(privateKey), authKey };
	} catch {
		return null;
	}
}

export function storeUnlockedSession(session: UnlockedSession) {
	sessionStorage.setItem(
		SESSION_STORAGE_KEY,
		JSON.stringify({
			userId: session.userId,
			privateKey: encodeKey(session.privateKey),
			authKey: session.authKey
		} satisfies StoredSession)
	);
}

export function clearUnlockedSession() {
	sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

/** The last username that logged in on this device, to prefill the login form. */
export function getLastUsername() {
	try {
		return localStorage.getItem(LAST_USERNAME_STORAGE_KEY) ?? '';
	} catch {
		return '';
	}
}

export function setLastUsername(username: string) {
	try {
		localStorage.setItem(LAST_USERNAME_STORAGE_KEY, username);
	} catch {
		// Only a convenience, so it's fine if storage is unavailable.
	}
}

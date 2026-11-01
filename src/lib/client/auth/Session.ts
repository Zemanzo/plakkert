import { decodeKey, encodeKey } from '../cryptography/PrivateKey';

const SESSION_STORAGE_KEY = 'plakkert_session';
const REMEMBERED_SESSION_STORAGE_KEY = 'plakkert_rememberedSession';
const LAST_USERNAME_STORAGE_KEY = 'plakkert_lastUsername';

/** How long a remembered session lasts, counting from when the app was last used. */
export const REMEMBERED_SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The user whose private key has been unlocked in this tab. Kept in session
 * storage, so it is forgotten when the tab is closed. With "Stay logged in",
 * it is also remembered in local storage, for other tabs and later visits.
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

interface RememberedSession extends StoredSession {
	/** Milliseconds since the epoch. */
	expiresAt: number;
}

const toStored = (session: UnlockedSession): StoredSession => ({
	userId: session.userId,
	privateKey: encodeKey(session.privateKey),
	authKey: session.authKey
});

function getRememberedSession(): StoredSession | null {
	const stored = localStorage.getItem(REMEMBERED_SESSION_STORAGE_KEY);
	if (!stored) return null;
	const session = JSON.parse(stored) as RememberedSession;
	if (session.expiresAt > Date.now()) return session;
	localStorage.removeItem(REMEMBERED_SESSION_STORAGE_KEY);
	return null;
}

export function getUnlockedSession(): UnlockedSession | null {
	try {
		const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
		const session = stored ? (JSON.parse(stored) as StoredSession) : getRememberedSession();
		if (!session) return null;
		const { userId, privateKey, authKey } = session;
		return { userId, privateKey: decodeKey(privateKey), authKey };
	} catch {
		return null;
	}
}

export function storeUnlockedSession(session: UnlockedSession) {
	sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toStored(session)));
}

/**
 * Keeps the session in this tab, and with `remember`, also on this device for
 * another `REMEMBERED_SESSION_DAYS`. Otherwise, it's forgotten on this device,
 * once this tab is closed.
 */
export function keepUnlockedSession(session: UnlockedSession, remember: boolean) {
	storeUnlockedSession(session);
	try {
		if (remember) {
			localStorage.setItem(
				REMEMBERED_SESSION_STORAGE_KEY,
				JSON.stringify({
					...toStored(session),
					expiresAt: Date.now() + REMEMBERED_SESSION_DAYS * DAY_MS
				} satisfies RememberedSession)
			);
		} else {
			localStorage.removeItem(REMEMBERED_SESSION_STORAGE_KEY);
		}
	} catch {
		// Without local storage, the session is only kept in this tab.
	}
}

export function clearUnlockedSession() {
	sessionStorage.removeItem(SESSION_STORAGE_KEY);
	try {
		localStorage.removeItem(REMEMBERED_SESSION_STORAGE_KEY);
	} catch {
		// Then nothing was remembered either.
	}
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

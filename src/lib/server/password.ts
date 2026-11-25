import { and, eq, ne } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db/index';
import { account, session, user } from './db/schema';

/** Auth keys are 32 bytes in base64; anything much longer is a mistake. Like Better Auth's limit. */
const MAX_AUTH_KEY_LENGTH = 128;
/** The encrypted private key, salt and nonce are each a few dozen bytes in base64. */
const MAX_KEY_FIELD_LENGTH = 1024;
/** Lower than this, and the password would be easier to guess from the encrypted private key. */
const MIN_KDF_ITERATIONS = 100_000;
/** Higher than this, and logging in would take minutes. */
const MAX_KDF_ITERATIONS = 10_000_000;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A new password: its auth key, and the private key encrypted with it. */
export interface PasswordChange {
	currentAuthKey: string;
	newAuthKey: string;
	privateKey: string;
	salt: string;
	nonce: string;
	kdfIterations: number;
}

const isAuthKey = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_AUTH_KEY_LENGTH;

const isKeyField = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_KEY_FIELD_LENGTH && BASE64.test(value);

/** Checks a request body, returning the change, or what's wrong with it. */
export function parsePasswordChange(body: unknown): PasswordChange | { problem: string } {
	if (typeof body !== 'object' || body === null) return { problem: 'Expected an object' };
	const { currentAuthKey, newAuthKey, privateKey, salt, nonce, kdfIterations } = body as Record<
		string,
		unknown
	>;
	if (!isAuthKey(currentAuthKey)) return { problem: 'currentAuthKey is required' };
	if (!isAuthKey(newAuthKey)) return { problem: 'newAuthKey is required' };
	if (!isKeyField(privateKey)) return { problem: 'privateKey must be base64' };
	if (!isKeyField(salt)) return { problem: 'salt must be base64' };
	if (!isKeyField(nonce)) return { problem: 'nonce must be base64' };
	if (
		typeof kdfIterations !== 'number' ||
		!Number.isInteger(kdfIterations) ||
		kdfIterations < MIN_KDF_ITERATIONS ||
		kdfIterations > MAX_KDF_ITERATIONS
	) {
		return { problem: `kdfIterations must be a whole number from ${MIN_KDF_ITERATIONS}` };
	}
	return { currentAuthKey, newAuthKey, privateKey, salt, nonce, kdfIterations };
}

export type PasswordChangeResult =
	{ status: 200 } | { status: 400 | 403 | 409; body: { message: string; code: string } };

/**
 * Changes the user's password, if `currentAuthKey` is right: the server password becomes the new
 * auth key, and the private key is replaced with the one encrypted with the new password. Both
 * change together, as one without the other would lock the user out of their notes.
 *
 * Other sessions are ended, so devices that are logged in elsewhere have to log in with the new
 * password. The session that made the change stays. With the same auth key, only the private key
 * is replaced, e.g. when it's encrypted again with stronger settings, and sessions stay.
 */
export async function changePassword(
	userId: string,
	currentSessionId: string,
	change: PasswordChange
): Promise<PasswordChangeResult> {
	const credential = db
		.select({ id: account.id, password: account.password })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
		.get();
	if (!credential?.password) {
		return { status: 400, body: { message: 'This account has no password', code: 'NO_PASSWORD' } };
	}

	const { password } = await auth.$context;
	const isCurrent = await password.verify({
		hash: credential.password,
		password: change.currentAuthKey
	});
	if (!isCurrent) {
		return {
			status: 403,
			body: { message: 'The current password is wrong', code: 'INVALID_PASSWORD' }
		};
	}
	const isNewPassword = change.newAuthKey !== change.currentAuthKey;
	const newHash = isNewPassword ? await password.hash(change.newAuthKey) : credential.password;

	const changed = db.transaction((tx) => {
		// Only if the password is still the one that was checked, in case it changed meanwhile.
		const updated = tx
			.update(account)
			.set({ password: newHash })
			.where(and(eq(account.id, credential.id), eq(account.password, credential.password!)))
			.run();
		if (updated.changes !== 1) return false;

		const { privateKey, salt, nonce, kdfIterations } = change;
		tx.update(user)
			.set({ privateKey, salt, nonce, kdfIterations })
			.where(eq(user.id, userId))
			.run();
		if (isNewPassword) {
			tx.delete(session)
				.where(and(eq(session.userId, userId), ne(session.id, currentSessionId)))
				.run();
		}
		return true;
	});
	if (!changed) {
		return {
			status: 409,
			body: { message: 'The password was changed meanwhile', code: 'PASSWORD_CHANGED' }
		};
	}
	return { status: 200 };
}

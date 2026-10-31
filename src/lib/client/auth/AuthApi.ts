import { request } from '../Api';
import { INVITE_CODE_HEADER, type RegistrationMode } from '#lib/registration.js';

/** The current user as returned by `/api/user`. Binary fields are base64 encoded. */
export interface ServerUser {
	id: string;
	username: string;
	email: string;
	publicKey: string;
	privateKey: string;
	salt: string;
	nonce: string;
	kdfIterations: number;
}

async function postAuth(
	path: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
) {
	const response = await request(`/api/auth/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	return response.json();
}

export function signInUsername(username: string, password: string) {
	return postAuth('sign-in/username', { username, password, rememberMe: true }) as Promise<{
		user: { id: string };
	}>;
}

/**
 * @param inviteCode Needed when registration is invite only.
 */
export function signUpEmail(
	body: {
		email: string;
		name: string;
		username: string;
		password: string;
		publicKey: string;
		privateKey: string;
		salt: string;
		nonce: string;
		kdfIterations: number;
	},
	inviteCode?: string
) {
	return postAuth(
		'sign-up/email',
		{ ...body, rememberMe: true },
		inviteCode ? { [INVITE_CODE_HEADER]: inviteCode } : {}
	) as Promise<{
		user: { id: string };
	}>;
}

/** Whether anyone can create an account, only people with an invite code, or nobody. */
export async function fetchRegistrationMode() {
	const response = await request('/api/registration');
	return ((await response.json()) as { mode: RegistrationMode }).mode;
}

export function changePassword(currentPassword: string, newPassword: string) {
	return postAuth('change-password', { currentPassword, newPassword, revokeOtherSessions: false });
}

/** Replaces the encrypted private key, e.g. after re-encrypting it with stronger settings. */
export function updateEncryptedPrivateKey(body: {
	privateKey: string;
	salt: string;
	nonce: string;
	kdfIterations: number;
}) {
	return postAuth('update-user', body);
}

export function signOut() {
	return postAuth('sign-out', {});
}

export async function fetchServerUser() {
	const response = await request('/api/user');
	return (await response.json()) as ServerUser;
}

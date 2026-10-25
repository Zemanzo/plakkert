import { request } from '../Api';

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

async function postAuth(path: string, body: Record<string, unknown>) {
	const response = await request(`/api/auth/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return response.json();
}

export function signInUsername(username: string, password: string) {
	return postAuth('sign-in/username', { username, password, rememberMe: true }) as Promise<{
		user: { id: string };
	}>;
}

export function signUpEmail(body: {
	email: string;
	name: string;
	username: string;
	password: string;
	publicKey: string;
	privateKey: string;
	salt: string;
	nonce: string;
	kdfIterations: number;
}) {
	return postAuth('sign-up/email', { ...body, rememberMe: true }) as Promise<{
		user: { id: string };
	}>;
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

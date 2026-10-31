import { createHash, timingSafeEqual } from 'node:crypto';
import type { RegistrationMode } from '#lib/registration.js';

const MODES: RegistrationMode[] = ['open', 'invite', 'closed'];

/**
 * Works out the registration mode from the `REGISTRATION` and `INVITE_CODE`
 * environment variables. It defaults to invite only, and invite only without
 * an invite code is closed, so forgetting to configure it never opens it up.
 */
export function resolveRegistrationMode(
	registration: string | undefined,
	inviteCode: string | undefined
): RegistrationMode {
	const mode = MODES.find((mode) => mode === registration?.trim().toLowerCase()) ?? 'invite';
	return mode === 'invite' && !inviteCode?.trim() ? 'closed' : mode;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Compares invite codes in constant time, so timing doesn't give away how much of one matched. */
export function isValidInviteCode(given: string | null | undefined, inviteCode: string) {
	return given != null && timingSafeEqual(digest(given.trim()), digest(inviteCode.trim()));
}

/**
 * Returns why someone can't sign up, or null if they can.
 *
 * @param given The invite code they entered.
 */
export function checkSignUp(
	mode: RegistrationMode,
	inviteCode: string | undefined,
	given: string | null | undefined
) {
	switch (mode) {
		case 'open':
			return null;
		case 'invite':
			return inviteCode && isValidInviteCode(given, inviteCode)
				? null
				: ({ code: 'INVALID_INVITE_CODE', message: 'That invite code isn’t valid.' } as const);
		case 'closed':
			return { code: 'REGISTRATION_CLOSED', message: 'Registration is closed.' } as const;
	}
}

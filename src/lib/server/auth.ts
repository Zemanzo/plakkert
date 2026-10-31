import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { ORIGIN, BETTER_AUTH_SECRET, REGISTRATION, INVITE_CODE } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.js';
import { INVITE_CODE_HEADER } from '#lib/registration.js';
import { checkSignUp, resolveRegistrationMode } from '#lib/server/registration.js';

export const registrationMode = resolveRegistrationMode(REGISTRATION, INVITE_CODE);

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true, disableSignUp: registrationMode === 'closed' },
	hooks: {
		// Checked here rather than on the register page, so it also applies to anyone calling the
		// sign-up endpoint directly. Better Auth also rate limits sign-up attempts, which makes
		// guessing the invite code impractical.
		before: createAuthMiddleware(async (ctx) => {
			if (!ctx.path.startsWith('/sign-up')) return;
			const problem = checkSignUp(
				registrationMode,
				INVITE_CODE,
				ctx.headers?.get(INVITE_CODE_HEADER)
			);
			if (problem) throw new APIError('FORBIDDEN', problem);
		})
	},
	user: {
		additionalFields: {
			publicKey: {
				type: 'string',
				required: true,
				input: true
			},
			privateKey: {
				// encrypted
				type: 'string',
				required: true,
				input: true
			},
			salt: {
				type: 'string',
				required: true,
				input: true
			},
			nonce: {
				type: 'string',
				required: true,
				input: true
			},
			// PBKDF2 iterations used to derive the key that encrypts the private key
			kdfIterations: {
				type: 'number',
				required: false,
				defaultValue: 100_000,
				input: true
			}
		}
	},
	plugins: [
		username(),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});

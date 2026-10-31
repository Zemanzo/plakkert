import type { RequestHandler } from './$types';
import { registrationMode } from '#lib/server/auth.js';
import type { RegistrationMode } from '#lib/registration.js';

/** Tells the register page whether it should ask for an invite code, or say registration is closed. */
export const GET: RequestHandler = () =>
	Response.json({ mode: registrationMode } satisfies { mode: RegistrationMode });

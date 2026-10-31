// Shared by the server and the register page.

/**
 * Who can create an account:
 * - `open`: anyone.
 * - `invite`: only people with the invite code (`INVITE_CODE`).
 * - `closed`: nobody.
 */
export type RegistrationMode = 'open' | 'invite' | 'closed';

/** Request header the invite code is sent in when signing up. */
export const INVITE_CODE_HEADER = 'x-invite-code';

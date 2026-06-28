export const COOKIE_PREFIX = 'plakkert_';

export interface Preferences {
	theme: 'light' | 'dark' | 'system';
}

export const defaultPreferences = {
	theme: 'system'
} as const satisfies Preferences;

/** Preferences that should also be stored in a cookie, for SSR reasons */
export const cookiePreferences = ['theme'] as const satisfies (keyof Preferences)[];

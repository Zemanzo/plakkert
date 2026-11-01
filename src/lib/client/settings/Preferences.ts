/** The user's settings on this device. They aren't synced. */
export interface Preferences {
	theme: 'light' | 'dark' | 'system';
	/** Shows two notes side by side on narrow screens, where there's otherwise room for one. */
	twoColumnsOnNarrowScreens: boolean;
	/** Stays logged in after closing the app, rather than only while it's open. See `Session.ts`. */
	stayLoggedIn: boolean;
}

export const defaultPreferences = {
	theme: 'system',
	twoColumnsOnNarrowScreens: false,
	stayLoggedIn: false
} as const satisfies Preferences;

/** The user's preferences, with the defaults for any that were added after they were saved. */
export function preferencesOf(user: { preferences?: Partial<Preferences> }): Preferences {
	return { ...defaultPreferences, ...user.preferences };
}

/** Must match the key read by the inline script in app.html. */
const THEME_STORAGE_KEY = 'plakkert_theme';

/**
 * Applies the theme, and remembers it so that app.html can apply it before the
 * app (and IndexedDB) has loaded, to avoid a flash of the wrong theme.
 */
export function applyTheme(theme: Preferences['theme']) {
	document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Only used to avoid a flash on load, so it's fine if storage is unavailable.
	}
}

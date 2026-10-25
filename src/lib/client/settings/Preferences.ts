export interface Preferences {
	theme: 'light' | 'dark' | 'system';
}

export const defaultPreferences = {
	theme: 'system'
} as const satisfies Preferences;

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

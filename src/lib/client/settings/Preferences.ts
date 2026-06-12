export interface Preferences {
	theme: 'light' | 'dark' | 'system';
}

export const defaultPreferences = {
	theme: 'system'
} as const satisfies Preferences;

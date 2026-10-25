import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	ORIGIN: {
		schema: optional,
		description: 'Public origin of the app, e.g. https://plakkert.example.com'
	},
	BETTER_AUTH_SECRET: {
		schema: optional,
		description: 'Secret used by Better Auth to sign sessions. Required in production.'
	},
	DATABASE_URL: {
		schema: (value) => {
			if (!value) throw new Error('DATABASE_URL is not set');
			return value;
		},
		description: 'Path to the SQLite database file'
	},
	PUBLIC_APP_NAME: {
		public: true,
		static: true,
		description: 'Name of the app, used for IndexedDB and other client-side storage'
	}
});

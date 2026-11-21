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
	REGISTRATION: {
		schema: optional,
		description:
			'Who can create an account: "invite" (default; needs INVITE_CODE), "open" or "closed"'
	},
	INVITE_CODE: {
		schema: optional,
		description: 'Code needed to create an account when REGISTRATION is "invite"'
	},
	MCP: {
		schema: (value) => {
			if (!value || value === 'off') return false;
			if (value === 'on') return true;
			throw new Error('MCP must be "on" or "off"');
		},
		description:
			'Whether users can let MCP clients (e.g. AI assistants) use their notes: "on" or "off" (default)'
	},
	MCP_REGISTRATIONS_PER_HOUR: {
		schema: (value) => {
			if (!value) return 20;
			const limit = Number(value);
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error('MCP_REGISTRATIONS_PER_HOUR must be a whole number, at least 1');
			}
			return limit;
		},
		description:
			'How many MCP clients can register from one IP address per hour (default 20), e.g. more when many users share one'
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

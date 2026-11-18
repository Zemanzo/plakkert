import type { User, Session } from 'better-auth/minimal';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		interface PageState {
			/** The note that is open. Opening one adds a history entry, so going back closes it. */
			openNoteId?: string;
			/** Whether the entry before this one is all notes, so going back to them can go back. */
			fromMain?: boolean;
		}
		// interface Platform {}
	}
}

export {};

// userState.svelte.ts
import { liveQuery } from 'dexie';
import { db, type User } from './Database';
import { page } from '$app/state';

class LocalUser {
	#user = $state<User | null>(null);
	#isLoading = $state(true);

	constructor() {
		const user = liveQuery(() =>
			page.data?.user?.id ? db.users.get(page.data.user.id) : undefined
		);

		user.subscribe((value) => {
			this.#isLoading = false;
			this.#user = value ?? null;
		});
	}

	get data() {
		return this.#user;
	}
	get isLoading() {
		return this.#isLoading;
	}
}

export const localUser = new LocalUser();

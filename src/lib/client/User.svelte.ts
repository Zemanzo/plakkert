// userState.svelte.ts
import { liveQuery } from 'dexie';
import { db, type User } from './Database';

class LocalUser {
	#user = $state<User | null>(null);
	#isLoading = $state(true);
	#subscription: { unsubscribe: () => void } | null = null;

	init(userId: string | undefined) {
		this.#subscription?.unsubscribe();
		if (!userId) {
			this.#isLoading = false;
			this.#user = null;
			return;
		}
		this.#isLoading = true;
		this.#subscription = liveQuery(() => db.users.get(userId)).subscribe((value) => {
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

export interface ToastAction {
	label: string;
	run: () => unknown;
}

export interface Toast {
	id: number;
	message: string;
	action?: ToastAction;
}

const TOAST_DURATION_MS = 6000;

/** Short messages at the bottom of the screen, e.g. to undo archiving a note. */
class Toasts {
	items = $state<Toast[]>([]);
	#nextId = 1;
	#timeouts = new Map<number, ReturnType<typeof setTimeout>>();

	show(message: string, action?: ToastAction) {
		const id = this.#nextId++;
		// One at a time, so they don't pile up: a new toast replaces the previous one.
		for (const toast of this.items) this.dismiss(toast.id);
		this.items = [{ id, message, action }];
		this.#timeouts.set(
			id,
			setTimeout(() => this.dismiss(id), TOAST_DURATION_MS)
		);
		return id;
	}

	dismiss(id: number) {
		clearTimeout(this.#timeouts.get(id));
		this.#timeouts.delete(id);
		this.items = this.items.filter((toast) => toast.id !== id);
	}

	/** Keeps a toast open while it is hovered or focused, so it doesn't vanish mid-click. */
	pause(id: number) {
		clearTimeout(this.#timeouts.get(id));
	}

	resume(id: number) {
		if (!this.items.some((toast) => toast.id === id)) return;
		this.#timeouts.set(
			id,
			setTimeout(() => this.dismiss(id), TOAST_DURATION_MS / 2)
		);
	}
}

export const toasts = new Toasts();

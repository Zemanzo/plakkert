export interface ConfirmOptions {
	title: string;
	message: string;
	confirmLabel: string;
	/** Styles the confirm button as destructive. */
	danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
	resolve: (confirmed: boolean) => void;
}

class Confirmation {
	request = $state<ConfirmRequest | null>(null);

	/** Asks the user to confirm something, e.g. deleting a note for good. */
	ask(options: ConfirmOptions) {
		// Only one question at a time; a new one cancels the previous one.
		this.request?.resolve(false);
		return new Promise<boolean>((resolve) => {
			this.request = { ...options, resolve };
		});
	}

	answer(confirmed: boolean) {
		this.request?.resolve(confirmed);
		this.request = null;
	}
}

export const confirmation = new Confirmation();

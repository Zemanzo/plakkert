/** How far the mouse has to move with the button down before a note is picked up. */
const DRAG_THRESHOLD = 6;
/** On touch screens, a note is picked up by holding it, so that swiping still scrolls. */
const LONG_PRESS_MS = 400;
/** How far a finger may move while holding before it counts as scrolling instead. */
const TOUCH_SLOP = 10;
/** How close to the top or bottom of the scroll area dragging scrolls it. */
const SCROLL_EDGE = 80;
const MAX_SCROLL_SPEED = 20;
/** How long to keep showing the new order if the notes don't catch up, e.g. when saving failed. */
const SETTLE_MS = 2000;

/** Finds the element that scrolls the notes, to scroll it while dragging near its edges. */
function scrollParent(element: HTMLElement) {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
	}
	return document.scrollingElement as HTMLElement | null;
}

export const sameOrder = (a: string[], b: string[]) =>
	a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Lets notes in a grid be reordered by dragging them: with the mouse, or by
 * holding a note on a touch screen. Other notes make room while dragging.
 *
 * The grid renders its notes in `order` while that is set, each in an
 * element with `data-slot-id` as a direct child of the grid, which must be
 * positioned (so it is the slots' offset parent). The dragged slot should be
 * moved by `offset`.
 */
export class DragReorder {
	/** The ids in the order to show: while dragging, and right after a drop until the notes catch up. */
	order = $state.raw<string[] | null>(null);
	/** The note being dragged. */
	draggedId = $state<string | null>(null);
	/** How far the dragged note is from its place in the grid. */
	offset = $state.raw({ x: 0, y: 0 });

	#grid: HTMLElement | null = null;
	#scroller: HTMLElement | null = null;
	#pending: {
		id: string;
		pointerId: number;
		pointerType: string;
		startX: number;
		startY: number;
		timer?: ReturnType<typeof setTimeout>;
	} | null = null;
	#pointer = { x: 0, y: 0 };
	/** Where the note was grabbed, relative to its top left corner. */
	#grab = { x: 0, y: 0 };
	#frame = 0;
	#suppressClick = false;

	constructor(
		private options: {
			/** The ids of the notes in the grid, in their current order. */
			ids: () => string[];
			enabled: () => boolean;
			/**
			 * Called when a note was dropped elsewhere, with its old and new index in
			 * `ids`. It should report its own errors.
			 */
			onMove: (from: number, to: number) => Promise<unknown>;
		}
	) {}

	/** Attaches to the grid element, e.g. with `{@attach reorder.attach}`. */
	attach = (grid: HTMLElement) => {
		this.#grid = grid;
		grid.addEventListener('pointerdown', this.#onPointerDown);
		// Clicks are captured, so a drop doesn't also open the note.
		grid.addEventListener('click', this.#onClick, { capture: true });
		grid.addEventListener('contextmenu', this.#onContextMenu);
		// Not passive, so that it can keep the page from scrolling while dragging on a touch screen.
		grid.addEventListener('touchmove', this.#onTouchMove, { passive: false });
		return () => {
			this.#stop(false);
			grid.removeEventListener('pointerdown', this.#onPointerDown);
			grid.removeEventListener('click', this.#onClick, { capture: true });
			grid.removeEventListener('contextmenu', this.#onContextMenu);
			grid.removeEventListener('touchmove', this.#onTouchMove);
			this.#grid = null;
		};
	};

	/** Forgets the new order once the notes are shown in it, i.e. once it has been saved. */
	settle(ids: string[]) {
		if (this.order && !this.draggedId && sameOrder(ids, this.order)) this.order = null;
	}

	/** Shows a note in a new place right away, while it is being saved. */
	showMoved(from: number, to: number) {
		const order = [...this.options.ids()];
		const [id] = order.splice(from, 1);
		order.splice(to, 0, id);
		this.order = order;
		this.#settleLater(order);
	}

	#slots() {
		return [...(this.#grid?.querySelectorAll<HTMLElement>(':scope > [data-slot-id]') ?? [])];
	}

	#slot(id: string) {
		return this.#slots().find((slot) => slot.dataset.slotId === id);
	}

	#onPointerDown = (event: PointerEvent) => {
		if (!event.isPrimary || event.button !== 0 || this.#pending || !this.options.enabled()) return;
		const slot =
			event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot-id]') : null;
		if (!slot || slot.parentElement !== this.#grid) return;

		this.#pointer = { x: event.clientX, y: event.clientY };
		this.#pending = {
			id: slot.dataset.slotId!,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			startX: event.clientX,
			startY: event.clientY,
			timer:
				event.pointerType === 'touch' ? setTimeout(() => this.#start(), LONG_PRESS_MS) : undefined
		};
		window.addEventListener('pointermove', this.#onPointerMove);
		window.addEventListener('pointerup', this.#onPointerUp);
		window.addEventListener('pointercancel', this.#onPointerCancel);
		window.addEventListener('keydown', this.#onKeyDown, { capture: true });
		window.addEventListener('blur', this.#onPointerCancel);
	};

	#onPointerMove = (event: PointerEvent) => {
		const pending = this.#pending;
		if (!pending || event.pointerId !== pending.pointerId) return;
		this.#pointer = { x: event.clientX, y: event.clientY };
		// While dragging, each animation frame follows the pointer.
		if (this.draggedId) return;

		const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
		if (pending.pointerType === 'touch') {
			// Moving before the note was picked up is scrolling.
			if (distance > TOUCH_SLOP) this.#stop(false);
		} else if (distance > DRAG_THRESHOLD) {
			this.#start();
		}
	};

	#onPointerUp = (event: PointerEvent) => {
		if (event.pointerId === this.#pending?.pointerId) this.#stop(true);
	};

	#onPointerCancel = () => this.#stop(false);

	#onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !this.draggedId) return;
		// Only cancel the drag, rather than also e.g. clearing the search.
		event.stopImmediatePropagation();
		event.preventDefault();
		this.#stop(false, false);
	};

	#onClick = (event: MouseEvent) => {
		if (!this.#suppressClick) return;
		this.#suppressClick = false;
		event.stopPropagation();
		event.preventDefault();
	};

	#onContextMenu = (event: Event) => {
		// Holding a note on a touch screen would otherwise open the context menu.
		if (this.#pending?.pointerType === 'touch') event.preventDefault();
	};

	#onTouchMove = (event: TouchEvent) => {
		if (this.draggedId) event.preventDefault();
	};

	#start() {
		const pending = this.#pending;
		const slot = pending && this.#slot(pending.id);
		if (!pending || !slot || !this.#grid) return this.#stop(false);
		clearTimeout(pending.timer);

		const rect = slot.getBoundingClientRect();
		this.#grab = { x: pending.startX - rect.left, y: pending.startY - rect.top };
		this.#scroller = scrollParent(this.#grid);
		this.order = this.options.ids();
		this.offset = { x: this.#pointer.x - pending.startX, y: this.#pointer.y - pending.startY };
		this.draggedId = pending.id;
		this.#frame = requestAnimationFrame(this.#tick);
	}

	#tick = () => {
		this.#scroll();
		this.#moveToPointer();
		this.#follow();
		this.#frame = requestAnimationFrame(this.#tick);
	};

	/** The pointer position relative to the grid. */
	#gridPointer() {
		const rect = this.#grid!.getBoundingClientRect();
		return { x: this.#pointer.x - rect.left, y: this.#pointer.y - rect.top };
	}

	/** Scrolls when dragging near the top or bottom of the scroll area. */
	#scroll() {
		const scroller = this.#scroller;
		if (!scroller) return;
		const rect = scroller.getBoundingClientRect();
		const edge = Math.min(SCROLL_EDGE, rect.height / 4);
		const { y } = this.#pointer;
		const depth =
			y < rect.top + edge
				? y - (rect.top + edge)
				: y > rect.bottom - edge
					? y - (rect.bottom - edge)
					: 0;
		if (depth)
			scroller.scrollTop += (Math.max(-edge, Math.min(edge, depth)) / edge) * MAX_SCROLL_SPEED;
	}

	/** Moves the dragged note to the place of the note under the pointer. */
	#moveToPointer() {
		const order = this.order;
		if (!order) return;
		// Slot positions are taken from the layout, ignoring the animations of notes making room, so
		// a note moving away under the pointer doesn't make the order flip back and forth.
		const { x, y } = this.#gridPointer();
		const slots = this.#slots();
		const contains = (slot: HTMLElement) =>
			x >= slot.offsetLeft &&
			x < slot.offsetLeft + slot.offsetWidth &&
			y >= slot.offsetTop &&
			y < slot.offsetTop + slot.offsetHeight;

		let target = slots.findIndex(contains);
		const last = slots.at(-1);
		// Past the last note, e.g. in the empty part of the last row: move it to the end.
		if (
			target === -1 &&
			last &&
			(y >= last.offsetTop + last.offsetHeight ||
				(y >= last.offsetTop && x >= last.offsetLeft + last.offsetWidth))
		) {
			target = slots.length - 1;
		}

		const id = this.draggedId!;
		const targetId = slots[target]?.dataset.slotId;
		if (!targetId || targetId === id) return;
		const reordered = order.filter((other) => other !== id);
		reordered.splice(order.indexOf(targetId), 0, id);
		this.order = reordered;
	}

	/** Keeps the dragged note under the pointer, wherever its place in the grid now is. */
	#follow() {
		const slot = this.#slot(this.draggedId!);
		if (!slot) return;
		const { x, y } = this.#gridPointer();
		this.offset = { x: x - this.#grab.x - slot.offsetLeft, y: y - this.#grab.y - slot.offsetTop };
	}

	/**
	 * @param drop Whether to move the note to where it was dragged, rather than back.
	 * @param released Whether the pointer was released, rather than e.g. Escape being pressed.
	 */
	#stop(drop: boolean, released = true) {
		const pending = this.#pending;
		if (!pending) return;
		clearTimeout(pending.timer);
		cancelAnimationFrame(this.#frame);
		window.removeEventListener('pointermove', this.#onPointerMove);
		window.removeEventListener('pointerup', this.#onPointerUp);
		window.removeEventListener('pointercancel', this.#onPointerCancel);
		window.removeEventListener('keydown', this.#onKeyDown, { capture: true });
		window.removeEventListener('blur', this.#onPointerCancel);
		this.#pending = null;

		const id = this.draggedId;
		const order = this.order;
		this.draggedId = null;
		// Without a drag, it's an ordinary click.
		if (!id || !order) return;

		// The click that follows releasing the note shouldn't open it. If no click follows, e.g. after
		// holding a note on a touch screen, the next one still counts.
		this.#suppressClick = true;
		const allowClicks = () => setTimeout(() => (this.#suppressClick = false));
		if (released) {
			allowClicks();
		} else {
			// Cancelled while the button is still down: the click comes once it's released.
			window.addEventListener('pointerup', allowClicks, { once: true });
		}

		const ids = this.options.ids();
		const from = ids.indexOf(id);
		const to = order.filter((other) => ids.includes(other)).indexOf(id);
		if (!drop || from === -1 || from === to) {
			this.order = null;
			return;
		}
		this.options.onMove(from, to);
		this.#settleLater(order);
	}

	#settleLater(order: string[]) {
		setTimeout(() => {
			if (this.order === order && !this.draggedId) this.order = null;
		}, SETTLE_MS);
	}
}

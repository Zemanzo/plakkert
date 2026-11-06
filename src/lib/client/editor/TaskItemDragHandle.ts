import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const TASK_ITEM = 'taskItem';
const SETTLE_MS = 160;
const SCROLL_EDGE = 56;
const MAX_SCROLL_SPEED = 16;

interface Slot {
	pos: number;
	size: number;
	el: HTMLElement;
	top: number;
	bottom: number;
	mid: number;
	height: number;
}

// Shared by every widget so ProseMirror can reuse the handle DOM between transactions.
const WIDGET_SPEC = {
	side: -1,
	key: 'task-drag-handle',
	ignoreSelection: true,
	stopEvent: () => true
};

export const TaskItemDragHandle = Extension.create({
	name: 'taskItemDragHandle',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('taskItemDragHandle'),
				props: {
					decorations(state) {
						const decorations: Decoration[] = [];
						state.doc.descendants((node, pos) => {
							if (node.type.name === TASK_ITEM) {
								// pos + 1 = start of the item's content
								decorations.push(Decoration.widget(pos + 1, renderHandle, WIDGET_SPEC));
							}
						});
						return DecorationSet.create(state.doc, decorations);
					}
				}
			})
		];
	}
});

function renderHandle(view: EditorView, getPos: () => number | undefined) {
	const el = document.createElement('span');
	el.className = 'task-drag-handle';
	el.contentEditable = 'false';
	el.setAttribute('role', 'button');
	el.setAttribute('aria-label', 'Drag to reorder');
	el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="7" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/>
    <circle cx="7" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>
    <circle cx="7" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/>
	</svg>`;

	el.addEventListener('pointerdown', (e) => {
		const widgetPos = getPos();
		if (widgetPos == null || e.button !== 0 || !view.dom.isContentEditable) return;
		e.preventDefault(); // no text selection, no focus change
		startDrag(view, widgetPos - 1, e);
	});

	return el;
}

function getScrollParent(el: HTMLElement): HTMLElement {
	let p = el.parentElement;
	while (p) {
		if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) {
			return p;
		}
		p = p.parentElement;
	}
	return document.scrollingElement as HTMLElement;
}

function startDrag(view: EditorView, itemPos: number, downEvent: PointerEvent) {
	const $item = view.state.doc.resolve(itemPos);
	const listStart = $item.start();

	// Measure all sibling items once, up front.
	const slots: Slot[] = [];
	$item.parent.forEach((child, offset) => {
		const pos = listStart + offset;
		const el = view.nodeDOM(pos);
		if (!(el instanceof HTMLElement)) return;
		const r = el.getBoundingClientRect();
		slots.push({
			pos,
			size: child.nodeSize,
			el,
			top: r.top,
			bottom: r.bottom,
			mid: (r.top + r.bottom) / 2,
			height: r.height
		});
	});

	const from = slots.findIndex((s) => s.pos === itemPos);
	if (from === -1 || slots.length < 2) return;

	const dragged = slots[from];
	const gap =
		from < slots.length - 1
			? slots[from + 1].top - dragged.bottom
			: dragged.top - slots[from - 1].bottom;
	const shift = dragged.height + gap; // how far siblings move to make room

	const scroller = getScrollParent(dragged.el);
	const startScroll = scroller.scrollTop;
	const startY = downEvent.clientY;
	let pointerY = startY;
	let target = from;
	let raf = 0;
	let settling = false;

	// We're changing styles/classes on ProseMirror-managed DOM. Pause its mutation observer so it
	// doesn't try to re-parse those changes as edits.
	const observer = (view as unknown as { domObserver?: { stop(): void; start(): void } })
		.domObserver;
	observer?.stop();

	slots.forEach((s) => s.el.classList.add('task-sorting'));
	dragged.el.classList.add('task-dragging');
	document.body.style.cursor = 'grabbing';

	const update = () => {
		const dy = pointerY - startY + (scroller.scrollTop - startScroll);
		dragged.el.style.transform = `translateY(${dy}px)`;

		// Target index = how many *other* items have their midpoint above the dragged item's centre.
		const center = dragged.mid + dy;
		target = slots.reduce((n, s, i) => (i !== from && s.mid < center ? n + 1 : n), 0);

		slots.forEach((s, i) => {
			if (i === from) return;
			let y = 0;
			if (target > from && i > from && i <= target) y = -shift;
			else if (target < from && i >= target && i < from) y = shift;
			s.el.style.transform = y ? `translateY(${y}px)` : '';
		});
	};

	const tick = () => {
		const bounds =
			scroller === document.scrollingElement
				? { top: 0, bottom: window.innerHeight }
				: scroller.getBoundingClientRect();
		const towardTop = (bounds.top + SCROLL_EDGE - pointerY) / SCROLL_EDGE;
		const towardBottom = (pointerY - (bounds.bottom - SCROLL_EDGE)) / SCROLL_EDGE;
		const v =
			towardTop > 0
				? -Math.min(towardTop, 1) * MAX_SCROLL_SPEED
				: towardBottom > 0
					? Math.min(towardBottom, 1) * MAX_SCROLL_SPEED
					: 0;
		if (v) {
			scroller.scrollTop += v;
			update();
		}
		raf = requestAnimationFrame(tick);
	};

	const cleanup = () => {
		slots.forEach((s) => {
			s.el.style.transform = '';
			s.el.style.transition = '';
			s.el.classList.remove('task-sorting', 'task-dragging');
		});
		document.body.style.cursor = '';
		observer?.start();
	};

	const onMove = (e: PointerEvent) => {
		if (e.pointerId !== downEvent.pointerId) return;
		pointerY = e.clientY;
		update();
	};
	const onUp = () => finish(true);
	const onCancel = () => finish(false);
	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(false);

	const finish = (commit: boolean) => {
		if (settling) return;
		settling = true;
		cancelAnimationFrame(raf);
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', onCancel);
		window.removeEventListener('keydown', onKey);

		const move = commit && target !== from;
		if (!move) slots.forEach((s, i) => i !== from && (s.el.style.transform = ''));

		// Animate the dragged item into its final slot, then commit the real document change.
		const finalOffset = !move
			? 0
			: target > from
				? slots[target].bottom - dragged.bottom
				: slots[target].top - dragged.top;
		dragged.el.style.transition = `transform ${SETTLE_MS}ms ease`;
		dragged.el.style.transform = `translateY(${finalOffset}px)`;

		window.setTimeout(() => {
			cleanup();
			if (move) moveItem(view, slots, from, target);
		}, SETTLE_MS);
	};

	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', onUp);
	window.addEventListener('pointercancel', onCancel);
	window.addEventListener('keydown', onKey);
	raf = requestAnimationFrame(tick);
}

function moveItem(view: EditorView, slots: Slot[], from: number, to: number) {
	const src = slots[from];
	const dst = slots[to];
	const node = view.state.doc.nodeAt(src.pos);
	if (!node || node.nodeSize !== src.size) return; // document changed mid-drag, bail out

	const insertAt = to > from ? dst.pos + dst.size : dst.pos;
	const selFrom = view.state.selection.from;
	const hadCaret = selFrom > src.pos && selFrom < src.pos + src.size;

	const tr = view.state.tr;
	tr.delete(src.pos, src.pos + src.size);
	const at = tr.mapping.map(insertAt);
	tr.insert(at, node);

	// Keep the caret in the same spot of the moved item.
	if (hadCaret) {
		tr.setSelection(TextSelection.near(tr.doc.resolve(at + (selFrom - src.pos))));
	}

	view.dispatch(tr);
}

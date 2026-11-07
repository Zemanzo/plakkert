<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { DragReorder } from './DragReorder.svelte';
	import Note from './Note.svelte';
	import type { NoteEntry } from './NoteStore.svelte';

	let {
		entries,
		focusedNoteId = $bindable(),
		twoColumns = false,
		onMove,
		onCloneNote
	}: {
		entries: NoteEntry[];
		focusedNoteId: string | null;
		/** Shows at least two notes side by side, even when they have to be narrower for that. */
		twoColumns?: boolean;
		/**
		 * Moves a note to another place in `entries`. Only when given can notes be
		 * reordered, by dragging them or with Shift and the arrow keys.
		 */
		onMove?: (from: number, to: number) => Promise<unknown>;
		onCloneNote: (id: string) => void;
	} = $props();

	let grid = $state<HTMLDivElement>();
	let announcement = $state('');

	const ids = $derived(entries.map((entry) => entry.note.id));
	const canReorder = $derived(!!onMove && focusedNoteId === null && entries.length > 1);

	const reorder = new DragReorder({
		ids: () => ids,
		enabled: () => canReorder,
		onMove: (from, to) => move(from, to)
	});

	// While dragging, and until a move has been saved, the notes are shown in the new order.
	const shown = $derived.by(() => {
		const order = reorder.order;
		if (!order) return entries;
		const byId = new Map(entries.map((entry) => [entry.note.id, entry]));
		const ordered = order.flatMap((id) => byId.get(id) ?? []);
		// Notes that showed up meanwhile, e.g. from another device, go first like new notes do.
		return [...entries.filter((entry) => !order.includes(entry.note.id)), ...ordered];
	});

	$effect(() => reorder.settle(ids));

	const reducedMotion =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	// The dragged note follows the pointer instead. An open note is fixed in place, which a slot
	// that moves would carry along.
	const flipDuration = (id: string) =>
		reducedMotion || focusedNoteId !== null || id === reorder.draggedId ? 0 : 200;

	function move(from: number, to: number) {
		announcement = `Moved to position ${to + 1} of ${entries.length}.`;
		return onMove!(from, to);
	}

	async function onkeydown(event: KeyboardEvent) {
		const note = event.target;
		if (!event.shiftKey || !canReorder || !grid) return;
		if (!(note instanceof HTMLElement) || !note.matches('[data-note-id]')) return;

		const slots = [...grid.children] as HTMLElement[];
		const columns = slots.filter((slot) => slot.offsetTop === slots[0].offsetTop).length;
		const steps: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -columns,
			ArrowDown: columns
		};
		const step = steps[event.key];
		if (!step) return;
		event.preventDefault();

		const id = note.dataset.noteId!;
		const from = ids.indexOf(id);
		const to = Math.max(0, Math.min(ids.length - 1, from + step));
		if (to === from) return;
		reorder.showMoved(from, to);
		move(from, to);
		// Moving the note in the page takes the focus away from it.
		await tick();
		grid.querySelector<HTMLElement>(`[data-note-id="${id}"]`)?.focus();
	}
</script>

<!-- The key presses come from the notes in the grid, which are buttons. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={grid}
	class="notesGrid"
	class:twoColumns
	class:dragging={reorder.draggedId !== null}
	{@attach reorder.attach}
	{onkeydown}
>
	{#each shown as entry (entry.note.id)}
		{@const isDragged = entry.note.id === reorder.draggedId}
		<div
			class="slot"
			class:closed={entry.note.id !== focusedNoteId}
			class:isDragged
			data-slot-id={entry.note.id}
			style:translate={isDragged ? `${reorder.offset.x}px ${reorder.offset.y}px` : null}
			animate:flip={{ duration: flipDuration(entry.note.id) }}
		>
			<Note
				{entry}
				bind:focusedNoteId
				onClone={() => {
					onCloneNote(entry.note.id);
				}}
			/>
		</div>
	{/each}
</div>
<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
	.notesGrid {
		/* The slots' offset parent, which dragging relies on. */
		position: relative;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(350px, 100%), 1fr));
		grid-auto-rows: minmax(40px, auto);
		align-items: start;
		gap: 8px;
		align-content: start;
		justify-content: center;
		max-width: 100%;

		&.twoColumns {
			/* Half of the width, minus the gap, so that there are never fewer than two columns. */
			grid-template-columns: repeat(auto-fill, minmax(min(350px, calc(50% - 4px)), 1fr));
		}

		&.dragging,
		&.dragging :global(*) {
			cursor: grabbing;
		}
	}

	/* Smaller notes, when that's what it takes to fit two of them side by side. */
	@media (max-width: 600px) {
		/* Not while it's still moving back into place after closing. */
		.twoColumns .slot.closed :global(.container:not(.isFloating)) {
			height: 200px;
		}

		.twoColumns .slot.closed :global([data-note-id]) {
			padding-inline: var(--spacing-md);
		}
	}

	.slot {
		/* A dropped note glides into its place. */
		transition:
			translate var(--transition-duration) ease,
			rotate var(--transition-duration) ease;

		&.closed {
			/* Holding a note on a touch screen picks it up, rather than selecting text. */
			user-select: none;
			-webkit-touch-callout: none;
		}

		&.isDragged {
			z-index: 1;
			rotate: 2deg;
			filter: drop-shadow(0 8px 12px #0004);
			transition: rotate var(--transition-duration) ease;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.slot {
			transition: none;
		}
	}
</style>

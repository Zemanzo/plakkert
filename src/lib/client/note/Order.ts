import { POSITION_TAG, type NoteTags } from '../tags/Tags';

// Notes are ordered by a position per user, highest first. A note that was never moved has its
// creation time as its position, so new notes show up at the top. Moving a note gives it a
// position between those of its new neighbours, so usually only that note changes.

type Orderable = { note: { id: string; createdAt: Date }; tags: NoteTags };

/** How far apart notes are placed when there is no neighbour on one side, or when respacing. */
const STEP = 1000;

export function notePosition(entry: Orderable) {
	return entry.tags[POSITION_TAG] ?? entry.note.createdAt.getTime();
}

/** Sorts notes by the user's order: highest position first, then newest first. */
export function byPosition(a: Orderable, b: Orderable) {
	return (
		notePosition(b) - notePosition(a) ||
		b.note.createdAt.getTime() - a.note.createdAt.getTime() ||
		a.note.id.localeCompare(b.note.id)
	);
}

/**
 * Works out the new positions after moving a note within a list that is
 * sorted with `byPosition`.
 *
 * @param from The index of the note to move.
 * @param to The index it should end up at.
 * @returns The new position of each note that changes: usually just the moved
 *   one, but every note in the list when there is no room left between its
 *   new neighbours.
 */
export function positionsAfterMove(list: Orderable[], from: number, to: number) {
	const changes = new Map<string, number>();
	if (from === to || !list[from] || to < 0 || to >= list.length) return changes;

	const reordered = [...list];
	const [moved] = reordered.splice(from, 1);
	reordered.splice(to, 0, moved);

	const above = reordered[to - 1];
	const below = reordered[to + 1];
	const position =
		above && below
			? (notePosition(above) + notePosition(below)) / 2
			: above
				? notePosition(above) - STEP
				: notePosition(below) + STEP;

	if ((!above || position < notePosition(above)) && (!below || position > notePosition(below))) {
		changes.set(moved.note.id, position);
		return changes;
	}

	// The neighbours are too close together (or equal), so space out the whole list instead.
	const top = Math.max(...list.map(notePosition));
	reordered.forEach((entry, index) => {
		const respaced = top - index * STEP;
		if (respaced !== notePosition(entry) || entry === moved) changes.set(entry.note.id, respaced);
	});
	return changes;
}

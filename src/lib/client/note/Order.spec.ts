import { describe, expect, it } from 'vitest';
import { POSITION_TAG, type NoteTags } from '../tags/Tags';
import { byPosition, notePosition, positionsAfterMove } from './Order';

function entry(id: string, createdAt: number, position?: number) {
	const tags: NoteTags = position === undefined ? {} : { [POSITION_TAG]: position };
	return { note: { id, createdAt: new Date(createdAt) }, tags };
}

/** Applies the changes, and returns the ids in their new order. */
function move(list: ReturnType<typeof entry>[], from: number, to: number) {
	const changes = positionsAfterMove(list, from, to);
	const moved = list.map((item) => {
		const position = changes.get(item.note.id);
		return position === undefined
			? item
			: entry(item.note.id, item.note.createdAt.getTime(), position);
	});
	return { changes, ids: moved.sort(byPosition).map((item) => item.note.id) };
}

describe('byPosition', () => {
	it('puts notes that were never moved newest first', () => {
		const list = [entry('old', 1000), entry('new', 3000), entry('middle', 2000)];
		expect(list.sort(byPosition).map((item) => item.note.id)).toEqual(['new', 'middle', 'old']);
	});

	it('uses the position of moved notes instead of their creation time', () => {
		const list = [entry('old', 1000, 5000), entry('new', 3000)];
		expect(list.sort(byPosition).map((item) => item.note.id)).toEqual(['old', 'new']);
		expect(notePosition(list[0])).toBe(5000);
	});
});

describe('positionsAfterMove', () => {
	const list = [entry('a', 40_000), entry('b', 30_000), entry('c', 20_000), entry('d', 10_000)];

	it('only changes the moved note, placing it between its new neighbours', () => {
		const { changes, ids } = move(list, 3, 1);
		expect(ids).toEqual(['a', 'd', 'b', 'c']);
		expect([...changes.keys()]).toEqual(['d']);
		expect(changes.get('d')).toBe(35_000);
	});

	it('moves notes down as well as up', () => {
		expect(move(list, 0, 2).ids).toEqual(['b', 'c', 'a', 'd']);
	});

	it('moves notes to the top and the bottom', () => {
		expect(move(list, 2, 0).ids).toEqual(['c', 'a', 'b', 'd']);
		expect(move(list, 1, 3).ids).toEqual(['a', 'c', 'd', 'b']);
	});

	it('changes nothing when the note stays where it is', () => {
		expect(positionsAfterMove(list, 2, 2).size).toBe(0);
		expect(positionsAfterMove(list, 1, 9).size).toBe(0);
	});

	it('spaces out the list when there is no room between the neighbours', () => {
		const crowded = [entry('a', 2), entry('b', 1, 1), entry('c', 1, 1), entry('d', 0)];
		const { changes, ids } = move(crowded, 3, 2);
		expect(ids).toEqual(['a', 'b', 'd', 'c']);
		expect(changes.size).toBeGreaterThan(1);
	});

	it('keeps working when a note is moved between the same two notes many times', () => {
		let current = list;
		for (let i = 0; i < 100; i++) {
			const changes = positionsAfterMove(current, 3, 1);
			current = current
				.map((item) => {
					const position = changes.get(item.note.id);
					return position === undefined
						? item
						: entry(item.note.id, item.note.createdAt.getTime(), position);
				})
				.sort(byPosition);
			expect(current[1].note.id).not.toBe(current[2].note.id);
			expect(notePosition(current[1])).toBeGreaterThan(notePosition(current[2]));
		}
	});
});

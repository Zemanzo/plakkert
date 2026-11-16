import { describe, expect, it } from 'vitest';
import {
	ARCHIVED_TAG,
	daysUntilDeleted,
	findExistingTag,
	isArchived,
	isTrashed,
	isTrashExpired,
	normalizeTagName,
	parseTags,
	TRASHED_TAG,
	userTags,
	validateTagName,
	withoutTag,
	tagOrderComparator,
	withChangedTags,
	withTag
} from './Tags';

const DAY = 24 * 60 * 60 * 1000;

describe('tag names', () => {
	it('trims and collapses whitespace', () => {
		expect(normalizeTagName('  to \t do  ')).toBe('to do');
	});

	it('rejects empty, reserved and overly long names', () => {
		expect(validateTagName('')).not.toBeNull();
		expect(validateTagName('$archived')).not.toBeNull();
		expect(validateTagName('x'.repeat(51))).not.toBeNull();
		expect(validateTagName('Work')).toBeNull();
	});

	it('finds an existing tag that only differs in case', () => {
		expect(findExistingTag(['Work', 'Home'], 'work')).toBe('Work');
		expect(findExistingTag(['Work'], 'works')).toBeUndefined();
	});
});

describe('note tags', () => {
	it('lists user tags by name, without the special tags', () => {
		expect(userTags({ b: 1, [ARCHIVED_TAG]: 2, A: 3, item10: 4, item9: 5 })).toEqual([
			'A',
			'b',
			'item9',
			'item10'
		]);
	});

	it('adds tags, keeping the original time of tags the note already has', () => {
		expect(withTag({}, 'work', 5)).toEqual({ work: 5 });
		const tags = { work: 1 };
		expect(withTag(tags, 'work', 5)).toBe(tags);
	});

	it('removes tags', () => {
		expect(withoutTag({ work: 1, home: 2 }, 'work')).toEqual({ home: 2 });
		const tags = { home: 2 };
		expect(withoutTag(tags, 'work')).toBe(tags);
	});

	it('renames tags, merging into a tag the note already has', () => {
		const rename = new Map([['wrok', 'work']]);
		expect(withChangedTags({ wrok: 3 }, rename)).toEqual({ work: 3 });
		expect(withChangedTags({ wrok: 3, work: 5 }, rename)).toEqual({ work: 3 });
		const tags = { home: 1 };
		expect(withChangedTags(tags, rename)).toBe(tags);
	});

	it('changes several tags at once, which can swap names', () => {
		const changes = new Map([
			['a', 'b'],
			['b', 'a'],
			['old', null],
			['recipe', 'recipes']
		]);
		expect(
			withChangedTags(
				{ a: 1, b: 2, old: 3, recipe: 4, recipes: 6, keep: 7, [ARCHIVED_TAG]: 8 },
				changes
			)
		).toEqual({ b: 1, a: 2, recipes: 4, keep: 7, [ARCHIVED_TAG]: 8 });
	});

	it('orders tags by the user’s own order, then the others by name', () => {
		const tags = ['b', 'item10', 'Work', 'a', 'item9'];
		expect(tags.sort(tagOrderComparator(['Work', 'b', 'gone']))).toEqual([
			'Work',
			'b',
			'a',
			'item9',
			'item10'
		]);
		expect(['b', 'a'].sort(tagOrderComparator([]))).toEqual(['a', 'b']);
	});

	it('tells whether a note is archived or trashed', () => {
		expect(isArchived({ [ARCHIVED_TAG]: 1 })).toBe(true);
		expect(isTrashed({ [ARCHIVED_TAG]: 1 })).toBe(false);
		expect(isTrashed({ [TRASHED_TAG]: 1 })).toBe(true);
	});
});

describe('trash', () => {
	const trashedAt = Date.UTC(2026, 0, 1);
	const tags = { [TRASHED_TAG]: trashedAt };

	it('deletes notes 30 days after they were trashed', () => {
		expect(isTrashExpired(tags, trashedAt + 30 * DAY - 1)).toBe(false);
		expect(isTrashExpired(tags, trashedAt + 30 * DAY)).toBe(true);
		expect(isTrashExpired({}, trashedAt + 100 * DAY)).toBe(false);
	});

	it('counts the days that are left, rounded up', () => {
		expect(daysUntilDeleted(tags, trashedAt)).toBe(30);
		expect(daysUntilDeleted(tags, trashedAt + 29.5 * DAY)).toBe(1);
		expect(daysUntilDeleted(tags, trashedAt + 31 * DAY)).toBe(0);
		expect(daysUntilDeleted({}, trashedAt)).toBeNull();
	});
});

describe('parseTags', () => {
	it('keeps valid tags and drops anything else', () => {
		expect(parseTags({ work: 1, bad: 'x', inf: Infinity, '': 2 })).toEqual({ work: 1 });
		expect(parseTags(null)).toEqual({});
		expect(parseTags(['work'])).toEqual({});
	});
});

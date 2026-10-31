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
	withRenamedTag,
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
		expect(withRenamedTag({ wrok: 3 }, 'wrok', 'work')).toEqual({ work: 3 });
		expect(withRenamedTag({ wrok: 3, work: 5 }, 'wrok', 'work')).toEqual({ work: 3 });
		expect(withRenamedTag({ home: 1 }, 'wrok', 'work')).toEqual({ home: 1 });
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

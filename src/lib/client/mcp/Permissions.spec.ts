import { describe, expect, it } from 'vitest';
import { renamedTagFilter } from './Permissions';

describe('renamedTagFilter', () => {
	it('renames the tags of a filter', () => {
		expect(renamedTagFilter(['Work', 'Private'], new Map([['Private', 'Secret']]))).toEqual([
			'Work',
			'Secret'
		]);
	});

	it('is null when none of its tags was renamed', () => {
		expect(renamedTagFilter(['Work'], new Map([['Home', 'House']]))).toBeNull();
		expect(renamedTagFilter([], new Map([['Home', 'House']]))).toBeNull();
	});

	it('renames tags whatever their case, as filters match them like that', () => {
		expect(renamedTagFilter(['private'], new Map([['Private', 'Secret']]))).toEqual(['Secret']);
	});

	it('keeps deleted tags, so the app sees no more than before', () => {
		expect(renamedTagFilter(['Private'], new Map([['Private', null]]))).toBeNull();
		expect(
			renamedTagFilter(
				['Private', 'Work'],
				new Map([
					['Private', null],
					['Work', 'Job']
				])
			)
		).toEqual(['Private', 'Job']);
	});

	it('merges tags that end up with the same name', () => {
		expect(renamedTagFilter(['Home', 'House'], new Map([['House', 'home']]))).toEqual(['Home']);
	});

	it('swaps names', () => {
		expect(
			renamedTagFilter(
				['A', 'B'],
				new Map([
					['A', 'B'],
					['B', 'A']
				])
			)
		).toEqual(['B', 'A']);
	});
});

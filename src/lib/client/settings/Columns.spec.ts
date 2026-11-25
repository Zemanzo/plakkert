import { describe, expect, it } from 'vitest';
import { columnHeight, columnsNeeded, columnsThatFit } from './Columns';

describe('columnsNeeded', () => {
	it('fills a column before starting the next', () => {
		expect(columnsNeeded([100, 100, 100], 10, 320)).toBe(1);
		expect(columnsNeeded([100, 100, 100], 10, 319)).toBe(2);
		expect(columnsNeeded([100, 100, 100], 10, 100)).toBe(3);
	});

	it('gives a section taller than a column a column of its own', () => {
		expect(columnsNeeded([50, 500, 50], 10, 200)).toBe(3);
	});
});

describe('columnHeight', () => {
	const gap = 10;

	it('keeps one column as tall as it is', () => {
		expect(columnHeight([100, 100], { gap, available: 50, columns: 1 })).toBeNull();
	});

	it('is the screen’s height when everything fits on it, also in one column', () => {
		expect(columnHeight([100, 100], { gap, available: 800, columns: 3 })).toBe(800);
		const height = columnHeight([300, 300, 300], { gap, available: 650, columns: 2 })!;
		expect(height).toBe(650);
		expect(columnsNeeded([300, 300, 300], gap, height)).toBe(2);
	});

	it('spreads over all columns, as evenly as can be, when they don’t fit on the screen', () => {
		const heights = [300, 300, 300, 300];
		const height = columnHeight(heights, { gap, available: 400, columns: 2 })!;
		expect(height).toBe(610);
		expect(columnsNeeded(heights, gap, height)).toBe(2);
	});

	it('is never lower than the tallest section', () => {
		expect(columnHeight([100, 900, 100], { gap, available: 300, columns: 2 })).toBe(1010);
	});
});

describe('columnsThatFit', () => {
	it('counts columns with the gaps between them, and at least one', () => {
		expect(columnsThatFit(1000, 300, 40)).toBe(3);
		expect(columnsThatFit(979, 300, 40)).toBe(2);
		expect(columnsThatFit(200, 300, 40)).toBe(1);
	});
});

import { describe, expect, it } from 'vitest';
import {
	keepsPrevious,
	MAX_HISTORY_BYTES,
	MAX_SESSION_MS,
	SESSION_GAP_MS,
	versionsToDrop
} from './history';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('keepsPrevious', () => {
	const createdAt = Date.UTC(2026, 10, 1);

	it('keeps the note as it was before a session of editing', () => {
		const previous = { updatedAt: createdAt + DAY, createdAt };
		expect(keepsPrevious(previous, previous.updatedAt + SESSION_GAP_MS, undefined)).toBe(true);
		expect(keepsPrevious(previous, previous.updatedAt + DAY, createdAt)).toBe(true);
	});

	it('doesn’t keep every save while typing', () => {
		const previous = { updatedAt: createdAt + DAY, createdAt };
		expect(keepsPrevious(previous, previous.updatedAt + 300, createdAt + DAY - MINUTE)).toBe(false);
		expect(
			keepsPrevious(
				previous,
				previous.updatedAt + SESSION_GAP_MS - 1,
				previous.updatedAt - HOUR / 2
			)
		).toBe(false);
	});

	it('keeps a version every hour during a long session', () => {
		const latest = createdAt + DAY;
		const previous = { updatedAt: latest + MAX_SESSION_MS, createdAt };
		expect(keepsPrevious(previous, previous.updatedAt + 1000, latest)).toBe(true);
		expect(keepsPrevious({ ...previous, updatedAt: latest + MAX_SESSION_MS - 1 }, 0, latest)).toBe(
			false
		);
	});

	it('counts a new note’s first session from when it was created', () => {
		expect(
			keepsPrevious({ updatedAt: createdAt + 300, createdAt }, createdAt + 600, undefined)
		).toBe(false);
		const anHourIn = { updatedAt: createdAt + MAX_SESSION_MS, createdAt };
		expect(keepsPrevious(anHourIn, anHourIn.updatedAt + 300, undefined)).toBe(true);
	});

	it('doesn’t keep what is kept already', () => {
		const previous = { updatedAt: createdAt + DAY, createdAt };
		expect(keepsPrevious(previous, previous.updatedAt + DAY, previous.updatedAt)).toBe(false);
	});
});

describe('versionsToDrop', () => {
	const now = Date.UTC(2026, 10, 22, 12);
	const version = (updatedAt: number, size = 100) => ({ updatedAt, size });

	it('keeps every version of the last day', () => {
		const versions = [now - MINUTE, now - HOUR, now - 23 * HOUR].map((at) => version(at));
		expect(versionsToDrop(versions, now)).toEqual([]);
	});

	it('keeps the newest of each day for a month', () => {
		const dayStart = Date.UTC(2026, 10, 10);
		const versions = [dayStart + HOUR, dayStart + 5 * HOUR, dayStart + 20 * HOUR].map((at) =>
			version(at)
		);
		expect(versionsToDrop(versions, now).sort()).toEqual([dayStart + HOUR, dayStart + 5 * HOUR]);
	});

	it('keeps the newest of each week until they’re 90 days old', () => {
		// Two days in the same UTC week (weeks count from 1 January 1970, a Thursday).
		const weekStart = Math.floor((now - 60 * DAY) / (7 * DAY)) * 7 * DAY;
		const versions = [version(weekStart + DAY), version(weekStart + 2 * DAY)];
		expect(versionsToDrop(versions, now)).toEqual([weekStart + DAY]);
		expect(versionsToDrop([version(now - 91 * DAY)], now)).toEqual([now - 91 * DAY]);
	});

	it('drops the oldest versions beyond the size limit, but keeps the newest', () => {
		const big = MAX_HISTORY_BYTES / 2;
		const versions = [now - 3 * HOUR, now - 2 * HOUR, now - HOUR].map((at) => version(at, big));
		expect(versionsToDrop(versions, now)).toEqual([now - 3 * HOUR]);
		expect(versionsToDrop([version(now - HOUR, MAX_HISTORY_BYTES * 2)], now)).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';
import { isClientTime, MAX_CLOCK_AHEAD_MS } from './notes';

describe('isClientTime', () => {
	const now = Date.UTC(2026, 10, 21);

	it('accepts times up to a little ahead of the server’s clock', () => {
		expect(isClientTime(now, now)).toBe(true);
		expect(isClientTime(0, now)).toBe(true);
		expect(isClientTime(now - 1000, now)).toBe(true);
		expect(isClientTime(now + MAX_CLOCK_AHEAD_MS, now)).toBe(true);
	});

	it('refuses times far ahead, which would win over every later change', () => {
		expect(isClientTime(now + MAX_CLOCK_AHEAD_MS + 1, now)).toBe(false);
		expect(isClientTime(8.64e15, now)).toBe(false);
		expect(isClientTime(1e20, now)).toBe(false);
	});

	it('refuses anything that isn’t a time', () => {
		expect(isClientTime(-1, now)).toBe(false);
		expect(isClientTime(now + 0.5, now)).toBe(false);
		expect(isClientTime(Number.NaN, now)).toBe(false);
		expect(isClientTime(String(now), now)).toBe(false);
		expect(isClientTime(null, now)).toBe(false);
	});
});

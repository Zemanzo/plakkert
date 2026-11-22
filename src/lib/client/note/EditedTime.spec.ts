import { describe, expect, it } from 'vitest';
import { formatEdited, formatVersionTime } from './EditedTime';

describe('formatEdited', () => {
	const now = new Date(2026, 10, 22, 18, 0);

	it('shows only the time for today', () => {
		expect(formatEdited(new Date(2026, 10, 22, 14, 32), now, 'en-GB')).toBe('14:32');
	});

	it('shows the day and time for earlier this year', () => {
		expect(formatEdited(new Date(2026, 10, 21, 9, 5), now, 'en-GB')).toBe('21 Nov, 9:05');
	});

	it('shows the day and year for other years', () => {
		expect(formatEdited(new Date(2025, 2, 3, 9, 5), now, 'en-GB')).toBe('3 Mar 2025');
	});
});

describe('formatVersionTime', () => {
	const now = new Date(2026, 10, 22, 18, 0);

	it('always shows the day and time, and the year if it’s another', () => {
		expect(formatVersionTime(new Date(2026, 10, 22, 14, 32), now, 'en-GB')).toBe(
			'Sun 22 Nov, 14:32'
		);
		expect(formatVersionTime(new Date(2025, 2, 3, 9, 5), now, 'en-GB')).toBe(
			'Mon, 3 Mar 2025, 9:05'
		);
	});
});

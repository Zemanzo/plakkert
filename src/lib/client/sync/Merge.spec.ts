import { describe, expect, it } from 'vitest';
import { mergeServerNote } from './Merge';

const earlier = new Date('2026-01-01T10:00:00.000Z');
const later = new Date('2026-01-01T10:00:00.250Z');

describe('mergeServerNote', () => {
	it('takes notes that only exist on the server', () => {
		expect(mergeServerNote(undefined, { updatedAt: earlier, deletedAt: null })).toBe('take-server');
	});

	it('takes the server version when it is newer', () => {
		expect(mergeServerNote({ updatedAt: earlier }, { updatedAt: later, deletedAt: null })).toBe(
			'take-server'
		);
	});

	it('keeps the local version when it is newer or the same', () => {
		expect(mergeServerNote({ updatedAt: later }, { updatedAt: earlier, deletedAt: null })).toBe(
			'keep-local'
		);
		expect(mergeServerNote({ updatedAt: later }, { updatedAt: later, deletedAt: null })).toBe(
			'keep-local'
		);
	});

	it('deletes local notes that were deleted on the server, even with newer local edits', () => {
		expect(mergeServerNote({ updatedAt: later }, { updatedAt: earlier, deletedAt: earlier })).toBe(
			'delete-local'
		);
	});

	it('ignores server deletions of notes that are already deleted or unknown locally', () => {
		expect(
			mergeServerNote(
				{ updatedAt: earlier, deletedAt: earlier },
				{ updatedAt: later, deletedAt: later }
			)
		).toBe('keep-local');
		expect(mergeServerNote(undefined, { updatedAt: later, deletedAt: later })).toBe('keep-local');
	});

	it('keeps a local deletion that has not been pushed yet', () => {
		expect(
			mergeServerNote(
				{ updatedAt: earlier, deletedAt: earlier },
				{ updatedAt: later, deletedAt: null }
			)
		).toBe('keep-local');
	});
});

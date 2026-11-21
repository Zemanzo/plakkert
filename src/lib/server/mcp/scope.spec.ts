import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_PERMISSIONS, type McpPermissions } from '#lib/mcp.js';
import { describeScope, inScope, tagProblem, type McpScope } from './scope';

const scope = (
	permissions: Partial<McpPermissions> = {},
	tags: string[] | null = []
): McpScope => ({
	permissions: { ...DEFAULT_MCP_PERMISSIONS, ...permissions },
	tags
});
const note = (tags: string[] | null = [], hidden: boolean | null = false) => ({ tags, hidden });

describe('which notes an app can see', () => {
	it('none without read', () => {
		expect(inScope(scope({ read: false }), note())).toBe(false);
	});

	it('hidden notes only when allowed', () => {
		expect(inScope(scope(), note([], true))).toBe(false);
		expect(inScope(scope({ readHidden: true }), note([], true))).toBe(true);
		expect(inScope(scope(), note([], false))).toBe(true);
	});

	it('with included tags, only notes with one of them, in any case', () => {
		const included = scope({ tagMode: 'include' }, ['Work', 'Groceries']);
		expect(inScope(included, note(['work']))).toBe(true);
		expect(inScope(included, note(['Home', 'Groceries']))).toBe(true);
		expect(inScope(included, note(['Home']))).toBe(false);
		expect(inScope(included, note([]))).toBe(false);
	});

	it('with excluded tags, all notes but those with one of them', () => {
		const excluded = scope({ tagMode: 'exclude' }, ['Private']);
		expect(inScope(excluded, note(['Work']))).toBe(true);
		expect(inScope(excluded, note([]))).toBe(true);
		expect(inScope(excluded, note(['work', 'PRIVATE']))).toBe(false);
	});

	it('no notes when the filter couldn’t be decrypted', () => {
		expect(inScope(scope({ readHidden: true }, null), note())).toBe(false);
	});

	it('notes whose tags couldn’t be decrypted only when nothing depends on them', () => {
		expect(inScope(scope({ readHidden: true }), note(null, null))).toBe(true);
		expect(inScope(scope(), note(null, null))).toBe(false);
		expect(
			inScope(scope({ readHidden: true, tagMode: 'exclude' }, ['Private']), note(null, null))
		).toBe(false);
	});
});

describe('tags an app can give notes', () => {
	it('all but the excluded ones', () => {
		const excluded = scope({ tagMode: 'exclude' }, ['Private']);
		expect(tagProblem(excluded, 'private')).toMatch(/may not use/);
		expect(tagProblem(excluded, 'Work')).toBeNull();
		expect(tagProblem(scope({ tagMode: 'include' }, ['Work']), 'Home')).toBeNull();
	});

	it('any when it can’t read, as the filter is about reading', () => {
		expect(
			tagProblem(scope({ read: false, tagMode: 'exclude' }, ['Private']), 'Private')
		).toBeNull();
	});
});

describe('what the app is told', () => {
	it('names the included tags, but never the excluded ones', () => {
		expect(describeScope(scope({ tagMode: 'include' }, ['Work']))).toContain('“Work”');
		expect(describeScope(scope({ tagMode: 'exclude' }, ['Secret plans']))).not.toContain('Secret');
		expect(describeScope(scope({ read: false }))).toMatch(/can’t read/);
	});
});

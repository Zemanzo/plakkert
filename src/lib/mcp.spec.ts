import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MCP_PERMISSIONS,
	MAX_FILTER_TAGS,
	parseMcpPermissions,
	parseMcpTagFilter
} from './mcp';

describe('MCP permissions', () => {
	const all = {
		read: true,
		readHidden: true,
		tagMode: 'exclude',
		create: true,
		edit: true,
		delete: true,
		organize: true,
		share: true
	} as const;

	it('are taken as they are when consistent', () => {
		expect(parseMcpPermissions(all)).toEqual(all);
		expect(parseMcpPermissions(DEFAULT_MCP_PERMISSIONS)).toEqual(DEFAULT_MCP_PERMISSIONS);
	});

	it('allow nothing that needs read without it, but creating', () => {
		expect(parseMcpPermissions({ ...all, read: false })).toEqual({
			read: false,
			readHidden: false,
			tagMode: 'exclude',
			create: true,
			edit: false,
			delete: false,
			organize: false,
			share: false
		});
	});

	it('refuse anything else', () => {
		expect(parseMcpPermissions(null)).toBeNull();
		expect(parseMcpPermissions({ ...all, tagMode: 'only' })).toBeNull();
		expect(parseMcpPermissions({ ...all, share: 'yes' })).toBeNull();
		const { edit: _, ...withoutEdit } = all;
		void _;
		expect(parseMcpPermissions(withoutEdit)).toBeNull();
	});
});

describe('MCP tag filters', () => {
	it('keep tag names, once each', () => {
		expect(parseMcpTagFilter(['Work', 'Work', 'Home'])).toEqual(['Work', 'Home']);
		expect(parseMcpTagFilter([])).toEqual([]);
	});

	it('are refused, rather than read as fewer tags or none, when they aren’t a list of tags', () => {
		expect(parseMcpTagFilter('Work')).toBeNull();
		expect(parseMcpTagFilter({ 0: 'Work' })).toBeNull();
		expect(parseMcpTagFilter(null)).toBeNull();
		expect(parseMcpTagFilter(['Work', ''])).toBeNull();
		expect(parseMcpTagFilter(['Work', 3])).toBeNull();
	});

	it('are refused when they have more tags than a filter can', () => {
		const tags = Array.from({ length: MAX_FILTER_TAGS }, (_, i) => `Tag ${i}`);
		expect(parseMcpTagFilter(tags)).toEqual(tags);
		expect(parseMcpTagFilter([...tags, 'One more'])).toBeNull();
		expect(parseMcpTagFilter([...tags, 'Tag 0'])).toEqual(tags);
	});
});

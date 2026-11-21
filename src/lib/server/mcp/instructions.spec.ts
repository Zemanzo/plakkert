import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_PERMISSIONS, type McpPermissions } from '#lib/mcp.js';
import { instructions } from './instructions';

const READ_TOOLS = /search_notes|get_note|list_tags|list_colors|include_archived/;

describe('instructions', () => {
	it('tell an app that may read how to find notes', () => {
		const text = instructions(DEFAULT_MCP_PERMISSIONS, 'Scope.');
		expect(text).toContain('Use search_notes to find notes');
		expect(text).toContain('list_colors');
		expect(text).toContain('Scope.');
		expect(text).toContain("You can't create notes, change their text");
	});

	it('only name tools the app has', () => {
		const createOnly: McpPermissions = { ...DEFAULT_MCP_PERMISSIONS, read: false, create: true };
		const text = instructions(createOnly, 'This app can’t read notes.');
		expect(text).not.toMatch(READ_TOOLS);
		expect(text).toContain('The user chose what you may do: create notes.');
		expect(text).toContain('Notes are written as Markdown');
		// Only an app that replaces text loses formatting.
		expect(text).not.toContain('lost when you replace');
	});

	it('explain Markdown only to apps that write text', () => {
		expect(instructions(DEFAULT_MCP_PERMISSIONS, '')).not.toContain('Markdown');
		const editor = { ...DEFAULT_MCP_PERMISSIONS, edit: true };
		expect(instructions(editor, '')).toContain('lost when you replace');
	});
});

import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import {
	buildExportZip,
	dateFileName,
	exportPaths,
	frontMatter,
	titleFileName,
	type ExportedNote
} from './ExportNotes';

const note = (markdown: string, extra: Partial<ExportedNote> = {}): ExportedNote => ({
	markdown,
	folder: 'Notes',
	tags: [],
	color: 'yellow',
	createdAt: new Date(2026, 0, 2, 3, 4),
	updatedAt: new Date(2026, 0, 5),
	hidden: false,
	...extra
});

async function readZip(zip: Blob, password?: string) {
	const reader = new ZipReader(new BlobReader(zip), { password });
	const files: Record<string, string> = {};
	for (const entry of await reader.getEntries()) {
		if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter());
	}
	await reader.close();
	return files;
}

describe('file names', () => {
	it('come from the first line, without Markdown', () => {
		expect(titleFileName('\n# Shopping *list*\n\nMilk')).toBe('Shopping list');
		expect(titleFileName('- [x] Call mum')).toBe('Call mum');
		expect(titleFileName('> Quote')).toBe('Quote');
	});

	it('leave out what file systems don’t allow', () => {
		expect(titleFileName('a/b\\c: "d"?')).toBe('a b c d');
		expect(titleFileName('Ends with dots...')).toBe('Ends with dots');
		expect(titleFileName('CON')).toBe('CON_');
		expect(titleFileName('   ')).toBe('Untitled');
		expect(titleFileName('x'.repeat(100))).toHaveLength(60);
	});

	it('can be the date a note was created instead', () => {
		expect(dateFileName(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03.04');
	});

	it('are unique within a folder, whatever their case', () => {
		const notes = [note('Todo'), note('todo'), note('Todo', { folder: 'Archive' })];
		expect(exportPaths(notes, false)).toEqual([
			'Notes/Todo.md',
			'Notes/todo (2).md',
			'Archive/Todo.md'
		]);
		expect(exportPaths(notes, true)).toEqual([
			'Notes/2026-01-02 03.04.md',
			'Notes/2026-01-02 03.04 (2).md',
			'Archive/2026-01-02 03.04.md'
		]);
	});
});

describe('front matter', () => {
	it('has the note’s details, safely quoted', () => {
		const text = frontMatter(
			note('x', { tags: ['work', 'say "hi"'], hidden: true, sharedBy: 'ann' })
		);
		expect(text).toBe(
			[
				'---',
				'tags: ["work","say \\"hi\\""]',
				'color: "yellow"',
				`created: "${new Date(2026, 0, 2, 3, 4).toISOString()}"`,
				`updated: "${new Date(2026, 0, 5).toISOString()}"`,
				'hidden: true',
				'shared_by: "ann"',
				'---',
				'',
				''
			].join('\n')
		);
	});
});

describe('the zip', () => {
	const notes = [
		note('# Groceries\n\nMilk', { tags: ['home'] }),
		note('Old idea', { folder: 'Archive', createdAt: new Date(2025, 0, 1) })
	];

	it('has a Markdown file per note, in its folder', async () => {
		const files = await readZip(await buildExportZip(notes));
		expect(Object.keys(files).sort()).toEqual(['Archive/Old idea.md', 'Notes/Groceries.md']);
		expect(files['Notes/Groceries.md']).toContain('tags: ["home"]');
		expect(files['Notes/Groceries.md']).toMatch(/---\n\n# Groceries\n\nMilk$/);
	});

	it('can only be read with its password, and doesn’t name files after their text', async () => {
		const zip = await buildExportZip(notes, 'correct horse');
		const files = await readZip(zip, 'correct horse');
		expect(Object.keys(files).sort()).toEqual([
			'Archive/2025-01-01 00.00.md',
			'Notes/2026-01-02 03.04.md'
		]);
		expect(files['Notes/2026-01-02 03.04.md']).toContain('Milk');

		await expect(readZip(zip, 'wrong')).rejects.toThrow();
		await expect(readZip(zip)).rejects.toThrow();
		// Nothing of the notes can be read from the file itself.
		const raw = new TextDecoder().decode(await zip.arrayBuffer());
		expect(raw).not.toContain('Milk');
		expect(raw).not.toContain('Groceries');
	});
});

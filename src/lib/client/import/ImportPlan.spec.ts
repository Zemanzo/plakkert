import { describe, expect, it } from 'vitest';
import { IMPORT_SOURCES, type ImportedNote, type ParseResult } from '.';
import { planImport } from './ImportPlan';

const keep = IMPORT_SOURCES[0];
const NOW = Date.UTC(2026, 10, 16);

let nextCreatedAt = Date.UTC(2024, 0, 1);
const imported = (fields: Partial<ImportedNote> = {}): ImportedNote => ({
	content: '<h1>Note</h1><p></p>',
	color: 'yellow',
	archived: false,
	labels: [],
	createdAt: nextCreatedAt++,
	updatedAt: nextCreatedAt,
	...fields
});

const parsed = (notes: ImportedNote[], rest: Partial<ParseResult> = {}): ParseResult => ({
	notes,
	trashed: 0,
	failed: [],
	...rest
});

describe('planImport', () => {
	it('gives every note the import tag, and archives the archived ones', () => {
		const archivedNote = imported({ archived: true, color: 'red' });
		const plan = planImport(keep, parsed([imported(), archivedNote]), [], new Set(), NOW);

		expect(plan.notes).toHaveLength(2);
		expect(plan.archived).toBe(1);
		expect(plan.notes[0].tags).toEqual({ 'Keep import': NOW });
		expect(plan.notes[1]).toEqual({
			data: { content: archivedNote.content, meta: { color: 'red' } },
			tags: { 'Keep import': NOW, $archived: NOW },
			createdAt: new Date(archivedNote.createdAt),
			updatedAt: new Date(archivedNote.updatedAt)
		});
	});

	it('turns labels into tags, counting the notes that get each', () => {
		const plan = planImport(
			keep,
			parsed([
				imported({ labels: ['Recipes', 'Work'] }),
				imported({ labels: ['  Recipes '] }),
				imported()
			]),
			[],
			new Set(),
			NOW
		);

		expect(plan.notes[0].tags).toEqual({ 'Keep import': NOW, Recipes: NOW, Work: NOW });
		expect(plan.notes[1].tags).toEqual({ 'Keep import': NOW, Recipes: NOW });
		expect(plan.labels).toEqual([
			{ name: 'Recipes', notes: 2, isNewTag: true },
			{ name: 'Work', notes: 1, isNewTag: true }
		]);
	});

	it('joins labels into existing tags that only differ in case', () => {
		const plan = planImport(
			keep,
			parsed([imported({ labels: ['recipes'] }), imported({ labels: ['RECIPES', 'Ideas'] })]),
			['Recipes', 'keep import'],
			new Set(),
			NOW
		);

		expect(plan.notes[0].tags).toEqual({ 'keep import': NOW, Recipes: NOW });
		expect(plan.labels).toEqual([
			{ name: 'Ideas', notes: 1, isNewTag: true },
			{ name: 'Recipes', notes: 2, isNewTag: false }
		]);
	});

	it('leaves out labels that can’t be tags, and shortens long ones', () => {
		const long = 'x'.repeat(80);
		const plan = planImport(
			keep,
			parsed([imported({ labels: ['$archived', '', long, 'Keep import'] })]),
			[],
			new Set(),
			NOW
		);

		expect(plan.notes[0].tags).toEqual({ 'Keep import': NOW, ['x'.repeat(50)]: NOW });
		expect(plan.labels.map((label) => label.name)).toEqual(['x'.repeat(50)]);
	});

	it('skips notes that were imported before', () => {
		const before = imported({ labels: ['Old'] });
		const plan = planImport(
			keep,
			parsed([before, imported()], { trashed: 2, failed: ['broken.json'] }),
			[],
			new Set([before.createdAt]),
			NOW
		);

		expect(plan.notes).toHaveLength(1);
		expect(plan.duplicates).toBe(1);
		expect(plan.labels).toEqual([]);
		expect(plan.trashed).toBe(2);
		expect(plan.failed).toEqual(['broken.json']);
	});
});

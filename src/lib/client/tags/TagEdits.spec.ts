import { describe, expect, it } from 'vitest';
import { planTagEdits, type TagRow } from './TagEdits';

const row = (original: string, changes: Partial<TagRow> = {}): TagRow => ({
	original,
	name: original,
	mergeInto: null,
	deleted: false,
	...changes
});

describe('planTagEdits', () => {
	it('changes nothing when nothing was edited', () => {
		const plan = planTagEdits([row('b'), row('a')]);
		expect(plan.changes.size).toBe(0);
		expect(plan.order).toEqual(['b', 'a']);
		expect(plan.hasErrors).toBe(false);
	});

	it('renames, deletes and reorders', () => {
		const plan = planTagEdits([
			row('home', { name: ' House ' }),
			row('old', { deleted: true }),
			row('work')
		]);
		expect(plan.changes).toEqual(
			new Map([
				['home', 'House'],
				['old', null]
			])
		);
		expect(plan.order).toEqual(['House', 'work']);
		expect(plan.outcomes.map((outcome) => outcome.name)).toEqual(['House', null, 'work']);
	});

	it('merges a tag renamed onto another, in any case, into that tag', () => {
		const plan = planTagEdits([row('recipe', { name: 'Recipes' }), row('recipes')]);
		expect(plan.changes).toEqual(new Map([['recipe', 'recipes']]));
		expect(plan.order).toEqual(['recipes']);
		expect(plan.outcomes[0].mergesWith).toBe('recipes');
		expect(plan.outcomes[1].mergesWith).toBeNull();
	});

	it('merges into a tag, which takes its new name', () => {
		const plan = planTagEdits([
			row('recipe', { mergeInto: 'recipes' }),
			row('recipes', { name: 'Cooking' })
		]);
		expect(plan.changes).toEqual(
			new Map([
				['recipe', 'Cooking'],
				['recipes', 'Cooking']
			])
		);
		expect(plan.outcomes[0].mergesWith).toBe('Cooking');
		expect(plan.order).toEqual(['Cooking']);
	});

	it('follows merges into tags that are merged themselves, and deleted ones', () => {
		const plan = planTagEdits([
			row('a', { mergeInto: 'b' }),
			row('b', { mergeInto: 'c' }),
			row('c'),
			row('d', { mergeInto: 'e' }),
			row('e', { deleted: true })
		]);
		expect(plan.outcomes.map((outcome) => outcome.name)).toEqual(['c', 'c', 'c', null, null]);
	});

	it('swaps names without merging', () => {
		const plan = planTagEdits([row('a', { name: 'b' }), row('b', { name: 'a' })]);
		expect(plan.changes).toEqual(
			new Map([
				['a', 'b'],
				['b', 'a']
			])
		);
		expect(plan.outcomes.every((outcome) => outcome.mergesWith === null)).toBe(true);
	});

	it('reports invalid names, without merging them', () => {
		const plan = planTagEdits([
			row('a', { name: ' ' }),
			row('b', { name: '' }),
			row('c', { name: '$x' })
		]);
		expect(plan.hasErrors).toBe(true);
		expect(plan.outcomes.map((outcome) => outcome.error !== null)).toEqual([true, true, true]);
		expect(plan.outcomes.every((outcome) => outcome.mergesWith === null)).toBe(true);
	});
});

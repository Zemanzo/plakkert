import { normalizeTagName, validateTagName } from './Tags';

/** A tag in the tags dialog, with what the user did to it so far. */
export interface TagRow {
	/** The tag's name before editing, which identifies the row. */
	original: string;
	/** The name as typed. */
	name: string;
	/** The `original` of the tag this one is merged into. */
	mergeInto: string | null;
	deleted: boolean;
}

/** What will happen to a tag on saving. */
export interface TagRowOutcome {
	/** The tag's name after saving, or null if it's deleted. */
	name: string | null;
	/** The tag it ends up merged with, by its name after saving: by merging, or renaming onto it. */
	mergesWith: string | null;
	/** Why the name can't be saved, if it can't. */
	error: string | null;
}

export interface TagEditPlan {
	/** Per row, in the same order. */
	outcomes: TagRowOutcome[];
	/** The tags to rename (to the new name) or remove (null), by their original name. */
	changes: Map<string, string | null>;
	/** The tags that are left, in the order of the rows. */
	order: string[];
	hasErrors: boolean;
}

const key = (name: string) => name.toLocaleLowerCase();

/**
 * Works out what saving the tags dialog does. Tags given the same name (in
 * any case) are merged, into the tag that already had that name, or else the
 * first of them. Tags merged into another one take its new name, and are
 * deleted along with it.
 */
export function planTagEdits(rows: readonly TagRow[]): TagEditPlan {
	const byOriginal = new Map(rows.map((row) => [row.original, row]));
	const kept = rows.filter((row) => !row.deleted && !row.mergeInto);

	// The name each kept tag gets: the one typed, or the name of the tag it's renamed onto.
	const typed = new Map(kept.map((row) => [row.original, normalizeTagName(row.name)]));
	const errors = new Map(
		kept.map((row) => [row.original, validateTagName(typed.get(row.original)!)])
	);
	// Tags with the same valid name, which are merged.
	const groups = new Map<string, TagRow[]>();
	for (const row of kept) {
		if (errors.get(row.original)) continue;
		const name = key(typed.get(row.original)!);
		groups.set(name, [...(groups.get(name) ?? []), row]);
	}
	const finalName = new Map(typed);
	for (const group of groups.values()) {
		const target = group.find((row) => typed.get(row.original) === row.original) ?? group[0];
		for (const row of group) finalName.set(row.original, typed.get(target.original)!);
	}

	/** The kept row a row ends up as, following merges; null when that's deleted. */
	const resolve = (row: TagRow): TagRow | null => {
		const seen = new Set<string>();
		let current: TagRow | undefined = row;
		while (current?.mergeInto && !current.deleted) {
			if (seen.has(current.original)) return null;
			seen.add(current.original);
			current = byOriginal.get(current.mergeInto);
		}
		return current && !current.deleted ? current : null;
	};

	const outcomes = rows.map((row): TagRowOutcome => {
		const target = resolve(row);
		if (!target) return { name: null, mergesWith: null, error: null };
		const name = finalName.get(target.original)!;
		const error = target === row ? errors.get(row.original)! : null;
		const merged = target !== row || (!error && groups.get(key(name))!.length > 1);
		// The tag that keeps its name isn't merged "with" anything; the others are merged into it.
		const mergesWith = merged && name !== row.original ? name : null;
		return { name, mergesWith, error };
	});

	const changes = new Map<string, string | null>();
	const order: string[] = [];
	rows.forEach((row, index) => {
		const { name } = outcomes[index];
		if (name !== row.original) changes.set(row.original, name);
		if (name !== null && !order.includes(name)) order.push(name);
	});

	return {
		outcomes,
		changes,
		order,
		hasErrors: outcomes.some((outcome) => outcome.error !== null)
	};
}

// How the settings' sections are spread over columns: down one column, and on in the next only
// when they'd go past the bottom of the screen, while there's room for another column. Sections
// are never split. A flexbox that wraps its column at a given height lays them out; this works out
// that height.

/** How many sections of these heights go in columns of `height`, filling one before the next. */
export function columnsNeeded(heights: number[], gap: number, height: number) {
	let columns = 1;
	let used = 0;
	for (const h of heights) {
		const next = used === 0 ? h : used + gap + h;
		if (next > height && used > 0) {
			columns++;
			used = h;
		} else {
			used = next;
		}
	}
	return columns;
}

/**
 * The height to give the sections' container, so they take at most `columns` columns: the screen's
 * height when they fit in it, otherwise the least height that fits them in all the columns there
 * are, as evenly as can be (and the page scrolls). Null for one column, which is as tall as it is.
 */
export function columnHeight(
	heights: number[],
	{ gap, available, columns }: { gap: number; available: number; columns: number }
): number | null {
	if (columns <= 1 || heights.length === 0) return null;
	const tallest = Math.max(...heights);
	const screen = Math.max(available, tallest);
	if (columnsNeeded(heights, gap, screen) <= columns) return screen;

	const total = heights.reduce((sum, h) => sum + h, 0) + gap * (heights.length - 1);
	// Every height that changes the outcome is the sum of a run of sections; trying those, from the
	// least, finds the lowest that fits, without stepping through every pixel. There are only a
	// handful of sections.
	const candidates = new Set<number>();
	for (let start = 0; start < heights.length; start++) {
		let sum = 0;
		for (let end = start; end < heights.length; end++) {
			sum += heights[end] + (end > start ? gap : 0);
			if (sum >= tallest) candidates.add(sum);
		}
	}
	for (const height of [...candidates].sort((a, b) => a - b)) {
		if (columnsNeeded(heights, gap, height) <= columns) return height;
	}
	return total;
}

/** How many columns of `columnWidth` fit in `width`, with `gap` between them; at least one. */
export function columnsThatFit(width: number, columnWidth: number, gap: number) {
	return Math.max(1, Math.floor((width + gap) / (columnWidth + gap)));
}

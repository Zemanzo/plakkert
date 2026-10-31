// Notes are end-to-end encrypted, so the server can't search them. Searching happens on the
// decrypted notes in the browser instead, which also means it works offline.

const BLOCK_TAGS = /<\/?(?:p|h[1-6]|li|ul|ol|pre|blockquote|div|br|hr|label)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decodeEntities(text: string) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (name.startsWith('#')) {
			const codePoint =
				name[1] === 'x' || name[1] === 'X'
					? parseInt(name.slice(2), 16)
					: parseInt(name.slice(1), 10);
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
		}
		return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
	});
}

/**
 * Extracts the text from a note's HTML, as written by the editor. Blocks are
 * separated by spaces, so words in different paragraphs don't run together.
 */
export function htmlToText(html: string) {
	return decodeEntities(html.replace(BLOCK_TAGS, ' ').replace(/<[^>]*>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

/** Makes text comparable regardless of case and accents, so "cafe" finds "Café". */
export function normalizeForSearch(text: string) {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Splits a search query into terms, which must all appear in a note for it to match. */
export function parseSearchQuery(query: string) {
	return normalizeForSearch(query).split(/\s+/).filter(Boolean);
}

/**
 * Builds the text a note is searched by: its content and its tags. Tags are
 * included with a "#" too, so "#work" only finds notes tagged "work".
 */
export function buildSearchText(normalizedContent: string, tags: string[]) {
	const tagText = tags.map((tag) => `#${tag}`).join(' ');
	return `${normalizedContent}\n${normalizeForSearch(tagText)}`;
}

export function matchesSearch(searchText: string, terms: string[]) {
	return terms.every((term) => searchText.includes(term));
}

import { describe, expect, it } from 'vitest';
import {
	buildSearchText,
	htmlToText,
	matchesSearch,
	normalizeForSearch,
	parseSearchQuery
} from './Search';

const search = (content: string, tags: string[], query: string) =>
	matchesSearch(
		buildSearchText(normalizeForSearch(htmlToText(content)), tags),
		parseSearchQuery(query)
	);

describe('htmlToText', () => {
	it('keeps the text and separates blocks', () => {
		expect(htmlToText('<h1>Groceries</h1><p>milk</p><ul><li><p>eggs</p></li></ul>')).toBe(
			'Groceries milk eggs'
		);
	});

	it('does not separate inline formatting', () => {
		expect(htmlToText('<p>un<strong>believ</strong>able</p>')).toBe('unbelievable');
	});

	it('decodes entities', () => {
		expect(htmlToText('<p>Tom &amp; Jerry &lt;3 &#233;&#x00e9;&nbsp;x &bogus;</p>')).toBe(
			'Tom & Jerry <3 éé x &bogus;'
		);
	});
});

describe('search', () => {
	const content = '<h1>Weekend</h1><p>Visit the Café near the station</p>';

	it('ignores case and accents', () => {
		expect(search(content, [], 'CAFE')).toBe(true);
		expect(search(content, [], 'café')).toBe(true);
	});

	it('requires every term to match, in any order', () => {
		expect(search(content, [], 'station weekend')).toBe(true);
		expect(search(content, [], 'station monday')).toBe(false);
	});

	it('matches on tags, and "#" only on tags', () => {
		expect(search(content, ['Plans'], 'plans')).toBe(true);
		expect(search(content, ['Plans'], '#plans')).toBe(true);
		expect(search(content, [], '#weekend')).toBe(false);
	});

	it('matches everything for an empty query', () => {
		expect(search(content, [], '   ')).toBe(true);
	});
});

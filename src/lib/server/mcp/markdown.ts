import { escapeHtml } from '#lib/client/import/NoteHtml.js';

// Markdown from MCP clients, turned into the HTML the editor stores. The other way round is
// `htmlToMarkdown` in `notes.ts`, which `get_note` uses, so a note read and written back stays the
// same, as far as Markdown can say it. Only what the editor has comes out (see
// `src/lib/client/editor/Extensions.ts`): headings, paragraphs, lists, checklists, quotes, code,
// rules, images and links, bold, italic, strikethrough and inline code. Everything else is text,
// escaped, so a client can't put HTML of its own in a note.
//
// Like in the editor, every line is a paragraph of its own. Blank lines only separate blocks.

const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const TASK = /^\[([ xX])\](?: +(.*)|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/;
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

/** Tabs count as four spaces, as in Markdown, so indentation can be compared. */
const expandTabs = (line: string) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length));
const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === '';

export function markdownToHtml(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
	return blocks(lines) || '<p></p>';
}

function startsBlock(line: string) {
	return (
		FENCE.test(line) ||
		HEADING.test(line) ||
		RULE.test(line) ||
		QUOTE.test(line) ||
		LIST_ITEM.test(line)
	);
}

function blocks(lines: string[]): string {
	let html = '';
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
			const code: string[] = [];
			for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
			i++; // the closing fence, if there is one
			const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
			html += `<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`;
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			const level = heading[1].length;
			html += `<h${level}>${inline(heading[2] ?? '')}</h${level}>`;
			i++;
			continue;
		}

		// Before lists, as "- - -" is a rule too.
		if (RULE.test(line)) {
			html += '<hr>';
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			const quoted: string[] = [];
			for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1]);
			html += `<blockquote>${blocks(quoted) || '<p></p>'}</blockquote>`;
			continue;
		}

		if (LIST_ITEM.test(line)) {
			const list = parseList(lines, i);
			html += list.html;
			i = list.end;
			continue;
		}

		for (; i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]); i++) {
			html += `<p>${inline(lines[i].trim())}</p>`;
		}
	}
	return html;
}

type ListKind = 'bullet' | 'ordered' | 'task';

interface ListItem {
	indent: number;
	kind: ListKind;
	/** Where the item's text starts, which its own lines are indented to. */
	contentIndent: number;
	number: number;
	checked: boolean;
	text: string;
}

function parseItem(line: string): ListItem | null {
	const match = LIST_ITEM.exec(line);
	if (!match) return null;
	const [, spaces, marker, gap, rest] = match;
	const ordered = /\d/.test(marker[0]);
	const task = ordered ? null : TASK.exec(rest);
	return {
		indent: spaces.length,
		kind: task ? 'task' : ordered ? 'ordered' : 'bullet',
		// Markdown allows up to four spaces after the marker; more is code, which isn't supported.
		contentIndent: spaces.length + marker.length + Math.min(Math.max(gap.length, 1), 4),
		number: ordered ? Number.parseInt(marker, 10) : 1,
		checked: !!task && task[1] !== ' ',
		text: task ? (task[2] ?? '') : rest
	};
}

/**
 * A list, from the item at `start` up to the first line that isn't part of it: one of a lesser
 * indent, or an item of another kind, as the editor can't mix checklist items with others.
 */
function parseList(lines: string[], start: number) {
	const first = parseItem(lines[start])!;
	const items: string[] = [];
	let i = start;
	while (i < lines.length) {
		const item = parseItem(lines[i]);
		if (!item || item.indent !== first.indent || item.kind !== first.kind) break;

		// The item's own lines: anything indented further, and blank lines within them.
		const body = [item.text];
		let j = i + 1;
		while (j < lines.length) {
			if (isBlank(lines[j])) {
				const next = lines.slice(j).findIndex((l) => !isBlank(l));
				if (next === -1 || indentOf(lines[j + next]) <= item.indent) break;
				body.push('');
				j++;
				continue;
			}
			if (indentOf(lines[j]) <= item.indent) break;
			body.push(lines[j].slice(Math.min(indentOf(lines[j]), item.contentIndent)));
			j++;
		}
		i = j;

		// An item starts with a paragraph, even an empty one, like in the editor.
		let content = body[0].trim() ? `<p>${inline(body[0].trim())}</p>` : '<p></p>';
		content += blocks(body.slice(1));
		items.push(
			item.kind === 'task'
				? `<li data-type="taskItem" data-checked="${item.checked}">${content}</li>`
				: `<li>${content}</li>`
		);

		// Blank lines between items keep the list going; anything else after one ends it.
		while (i < lines.length && isBlank(lines[i])) {
			const next = parseItem(lines[i + 1] ?? '');
			if (!next || next.indent !== first.indent || next.kind !== first.kind) break;
			i++;
		}
		if (i < lines.length && isBlank(lines[i])) break;
	}
	const html =
		first.kind === 'task'
			? `<ul data-type="taskList">${items.join('')}</ul>`
			: first.kind === 'ordered'
				? `<ol${first.number !== 1 ? ` start="${first.number}"` : ''}>${items.join('')}</ol>`
				: `<ul>${items.join('')}</ul>`;
	return { html, end: i };
}

// --- Inline ---

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^(https?:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

/**
 * Marks where code, escaped characters and images were taken out of a line, while the rest is
 * formatted. A character for private use, which is taken out of the text first.
 */
const MARK = String.fromCharCode(0xe000);
const MARKS = new RegExp(MARK, 'g');
const HELD = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

/**
 * Formatting within a line. Code and backslash escapes are taken out first, so nothing inside
 * them counts as formatting, and the rest is escaped before any tags are added.
 */
function inline(text: string): string {
	const held: string[] = [];
	const hold = (html: string) => `${MARK}${held.push(html) - 1}${MARK}`;

	let result = text
		.replace(MARKS, '')
		.replace(/(`+)(.+?)\1/g, (_, __, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
		.replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) => hold(escapeHtml(char)));
	result = escapeHtml(result);

	// The text between the markers, as escaped, with what was held put back as text, e.g. a URL.
	const plain = (escaped: string) =>
		escaped.replace(HELD, (_, index: string) => held[Number(index)].replace(/<[^>]+>/g, ''));
	const unescape = (escaped: string) =>
		plain(escaped).replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ENTITIES[name]);

	result = result
		.replace(/!\[([^\]]*)\]\(([^)\s]+)(?: +&quot;[^&]*&quot;)?\)/g, (match, alt: string, src) => {
			const url = unescape(src);
			if (!SAFE_IMAGE.test(url)) return match;
			return hold(`<img src="${escapeHtml(url)}" alt="${escapeHtml(unescape(alt))}">`);
		})
		// The label is formatted, but the URL is held, so formatting can't change it: "__" or "*"
		// in a URL is part of it.
		.replace(/\[([^\]]+)\]\(([^)\s]+)(?: +&quot;[^&]*&quot;)?\)/g, (match, label, href) => {
			const url = unescape(href);
			if (!SAFE_LINK.test(url)) return match;
			return `${hold(`<a href="${escapeHtml(url)}">`)}${label}${hold('</a>')}`;
		});
	result = emphasis(result);

	return result.replace(HELD, (_, index: string) => held[Number(index)]);
}

function emphasis(html: string) {
	return html
		.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
		.replace(/(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, '<strong>$1</strong>')
		.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>')
		.replace(/(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '<em>$1</em>')
		.replace(/(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '<em>$1</em>');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

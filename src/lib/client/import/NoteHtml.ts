/**
 * Builds note content, in the HTML the editor stores, from plain text. Shared
 * by the importers, which only bring over text and checklists, not formatting.
 */

export interface ChecklistItem {
	text: string;
	checked: boolean;
}

const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPED[char]);

/** Every line becomes a paragraph, so blank lines stay. Blank lines at the start and end are left out. */
function paragraphs(text: string) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	while (lines.length > 0 && !lines[0].trim()) lines.shift();
	while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
	return lines.map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p></p>')).join('');
}

function checklist(items: ChecklistItem[]) {
	const listItems = items
		.filter((item) => item.text.trim())
		.map(
			(item) =>
				`<li data-type="taskItem" data-checked="${item.checked}"><p>${escapeHtml(item.text.trim())}</p></li>`
		);
	return listItems.length > 0 ? `<ul data-type="taskList">${listItems.join('')}</ul>` : '';
}

/**
 * Like notes made in the app, it starts with the title as a heading, which is
 * left empty when there's no title.
 */
export function noteHtml({
	title = '',
	text = '',
	items = []
}: {
	title?: string;
	text?: string;
	items?: ChecklistItem[];
}) {
	const body = paragraphs(text) + checklist(items);
	return `<h1>${escapeHtml(title.trim())}</h1>${body || '<p></p>'}`;
}

import { type Node as PMNode, Mark, DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { getSchema } from '@tiptap/core';
import { extensions } from '../editor/Extensions';

export type ExportFormat = 'markdown' | 'text' | 'html';

export function serializeNote(doc: PMNode, format: ExportFormat): string {
	const md = format === 'markdown';
	return renderChildren(doc, md, md ? '\n\n' : '\n').trim() + '\n';
}

function renderChildren(parent: PMNode, md: boolean, separator: string): string {
	const parts: string[] = [];
	parent.forEach((child) => {
		const out = renderBlock(child, md);
		// Empty paragraphs are noise in Markdown, but give plain text its blank lines.
		if (out === '' && md) return;
		parts.push(out);
	});
	return parts.join(separator);
}

function renderBlock(node: PMNode, md: boolean): string {
	switch (node.type.name) {
		case 'heading':
			return (md ? '#'.repeat(node.attrs.level) + ' ' : '') + renderInline(node, md);
		case 'paragraph':
			return renderInline(node, md);
		case 'bulletList':
		case 'orderedList':
		case 'taskList':
			return renderList(node, md);
		case 'blockquote':
			return renderChildren(node, md, md ? '\n\n' : '\n')
				.split('\n')
				.map((line) => `> ${line}`.trimEnd())
				.join('\n');
		case 'codeBlock':
			return md
				? '```' + (node.attrs.language ?? '') + '\n' + node.textContent + '\n```'
				: node.textContent;
		case 'horizontalRule':
			return '---';
		default:
			return node.isTextblock ? renderInline(node, md) : renderChildren(node, md, '\n');
	}
}

function renderList(list: PMNode, md: boolean): string {
	const lines: string[] = [];
	list.forEach((item, _offset, index) => {
		let marker = '- ';
		if (item.type.name === 'taskItem') marker = `- [${item.attrs.checked ? 'x' : ' '}] `;
		else if (list.type.name === 'orderedList') marker = `${(list.attrs.start ?? 1) + index}. `;

		// An item holds a paragraph plus optionally a nested list; keep them tight.
		const body = renderChildren(item, md, '\n');
		lines.push(marker + body.split('\n').join('\n' + ' '.repeat(marker.length)));
	});
	return lines.join('\n');
}

function renderInline(node: PMNode, md: boolean): string {
	let out = '';
	node.forEach((child) => {
		if (child.isText) out += md ? applyMarks(child.text ?? '', child.marks) : (child.text ?? '');
		else if (child.type.name === 'hardBreak') out += md ? '  \n' : '\n';
		else out += child.textContent;
	});
	return out;
}

function applyMarks(text: string, marks: readonly Mark[]): string {
	if (!text.trim()) return text;
	// Keep surrounding whitespace outside the markers: "**bold **" isn't valid Markdown.
	const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
	let out = core;
	for (const mark of marks) {
		switch (mark.type.name) {
			case 'bold':
				out = `**${out}**`;
				break;
			case 'italic':
				out = `*${out}*`;
				break;
			case 'strike':
				out = `~~${out}~~`;
				break;
			case 'code':
				out = `\`${out}\``;
				break;
			case 'link':
				out = `[${out}](${mark.attrs.href})`;
				break;
		}
	}
	return lead + out + trail;
}

export async function copyToClipboard(content: string) {
	await navigator.clipboard.writeText(content);
}

export function downloadFile(content: string, filename: string, format: ExportFormat) {
	const type = format === 'markdown' ? 'text/markdown' : 'text/plain';
	const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Converts HTML content to markdown or plain text format.
 * This is a simplified string-based conversion that handles common HTML elements.
 */
export function htmlToFormat(html: string, format: ExportFormat): string {
	if (format === 'html') {
		return html;
	}
	// Browser DOMParser: HTML string -> DOM. Scripts aren't executed in a parsed document.
	const dom = new window.DOMParser().parseFromString(html, 'text/html');

	const pmDoc = PMDOMParser.fromSchema(getSchema(extensions)).parse(dom);
	return serializeNote(pmDoc, format);
}

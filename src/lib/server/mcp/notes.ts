import TurndownService from 'turndown';
import { buildSearchText, htmlToText, normalizeForSearch } from '#lib/client/search/Search.js';
import {
	isArchived,
	isHidden,
	isTrashed,
	parseNoteUserData,
	userTags
} from '#lib/client/tags/Tags.js';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '#lib/client/note/NoteColors.js';
import { selectUserNotes } from '../notes';
import { decryptJson, openNoteKey } from './crypto';
import type { McpCaller } from './oauth';

// The notes of the user an MCP client is reading for, decrypted for the length of one request.
// Only ever the caller's own notes: everything goes through `selectUserNotes(caller.userId)`,
// which only returns notes the user has access to, and is decrypted with their key.

export interface McpNote {
	id: string;
	/** The first line of the note. */
	title: string;
	markdown: string;
	/** Normalized for searching, like the app does. */
	searchText: string;
	tags: string[];
	archived: boolean;
	trashed: boolean;
	hidden: boolean;
	/** As the app names it, e.g. "red" or "teal". */
	color: string;
	createdAt: Date;
	updatedAt: Date;
	/** Who shared the note with the user, if it isn't theirs. */
	sharedBy: string | null;
}

const turndown = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-'
});
// The editor's checklists: `<li data-checked="true"><label><input type="checkbox"></label><div>…`.
turndown.addRule('taskItem', {
	filter: (node) => node.nodeName === 'LI' && node.hasAttribute('data-checked'),
	replacement: (content, node) => {
		const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
		return `- [${checked ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`;
	}
});
turndown.remove(['input', 'script', 'style']);

export function htmlToMarkdown(html: string) {
	return turndown.turndown(html).trim();
}

/** The first line of a note's text, as its title. */
function titleOf(markdown: string) {
	const line = markdown
		.split('\n')
		.map((l) => l.replace(/^(#+\s*|[-*+]\s+(\[[ xX]\]\s*)?|>\s*)/, '').trim())
		.find(Boolean);
	return (line ?? '').slice(0, 100) || 'Untitled';
}

/** The colours as the app names them. Two ids differ from their names, from earlier versions. */
const COLOR_NAMES: Record<string, string> = Object.fromEntries(
	NOTE_COLORS.map(({ id, label }) => [id, label.toLowerCase()])
);
export const MCP_COLORS = [...new Set(Object.values(COLOR_NAMES))];

/** A note's colour as the app shows it. Notes without a known colour are yellow there too. */
export const colorName = (id: unknown) =>
	COLOR_NAMES[typeof id === 'string' ? id : ''] ?? COLOR_NAMES[DEFAULT_NOTE_COLOR];

/**
 * Decrypts all notes of the caller. A note whose key or text can't be decrypted is skipped, and
 * only its id is reported, never anything of its content. A note whose tags can't be decrypted
 * is still there, without tags, like in the app.
 */
export async function loadNotes(caller: McpCaller) {
	const notes: McpNote[] = [];
	const skippedIds: string[] = [];
	for (const row of selectUserNotes(caller.userId).all()) {
		if (row.deletedAt || !row.content) continue;
		let noteKey: Uint8Array;
		let data: { content?: unknown; meta?: { color?: unknown } };
		try {
			noteKey = await openNoteKey(
				new Uint8Array(Buffer.from(row.noteKey, 'base64')),
				caller.publicKey,
				caller.privateKey
			);
			data = (await decryptJson(new Uint8Array(row.content as Buffer), noteKey)) as typeof data;
		} catch {
			skippedIds.push(row.id);
			continue;
		}
		let tags = {};
		if (row.tags) {
			try {
				tags = parseNoteUserData(
					await decryptJson(new Uint8Array(row.tags as Buffer), noteKey)
				).tags;
			} catch {
				// Like the app: the note is still shown, just without its tags.
			}
		}
		const html = typeof data.content === 'string' ? data.content : '';
		const text = htmlToText(html);
		let markdown: string;
		try {
			markdown = htmlToMarkdown(html);
		} catch {
			// Unusual HTML, e.g. from another app: the text is better than leaving the note out.
			markdown = text;
		}
		notes.push({
			id: row.id,
			title: titleOf(markdown),
			markdown,
			searchText: buildSearchText(normalizeForSearch(text), userTags(tags)),
			tags: userTags(tags),
			archived: isArchived(tags),
			trashed: isTrashed(tags),
			hidden: isHidden(tags),
			color: colorName(data.meta?.color),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			sharedBy: row.owner === caller.userId ? null : row.ownerUsername
		});
	}
	return { notes, skippedIds };
}

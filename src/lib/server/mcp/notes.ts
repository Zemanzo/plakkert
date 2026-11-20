import TurndownService from 'turndown';
import { buildSearchText, htmlToText, normalizeForSearch } from '#lib/client/search/Search.js';
import {
	isArchived,
	isHidden,
	isTrashed,
	parseNoteUserData,
	userTags
} from '#lib/client/tags/Tags.js';
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

/**
 * Decrypts all notes of the caller. Notes that can't be decrypted are skipped and counted, like
 * the app does.
 */
export async function loadNotes(caller: McpCaller) {
	const notes: McpNote[] = [];
	let failed = 0;
	for (const row of selectUserNotes(caller.userId).all()) {
		if (row.deletedAt || !row.content) continue;
		try {
			const noteKey = await openNoteKey(
				new Uint8Array(Buffer.from(row.noteKey, 'base64')),
				caller.publicKey,
				caller.privateKey
			);
			const data = (await decryptJson(new Uint8Array(row.content as Buffer), noteKey)) as {
				content: string;
				meta?: { color?: string };
			};
			const { tags } = row.tags
				? parseNoteUserData(await decryptJson(new Uint8Array(row.tags as Buffer), noteKey))
				: { tags: {} };
			const markdown = htmlToMarkdown(data.content ?? '');
			notes.push({
				id: row.id,
				title: titleOf(markdown),
				markdown,
				searchText: buildSearchText(
					normalizeForSearch(htmlToText(data.content ?? '')),
					userTags(tags)
				),
				tags: userTags(tags),
				archived: isArchived(tags),
				trashed: isTrashed(tags),
				hidden: isHidden(tags),
				color: data.meta?.color ?? 'default',
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				sharedBy: row.owner === caller.userId ? null : row.ownerUsername
			});
		} catch {
			failed++;
		}
	}
	return { notes, failed };
}

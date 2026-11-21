import TurndownService from 'turndown';
import { buildSearchText, htmlToText, normalizeForSearch } from '#lib/client/search/Search.js';
import {
	isArchived,
	isHidden,
	isTrashed,
	parseNoteUserData,
	userTags,
	type NoteUserData
} from '#lib/client/tags/Tags.js';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '#lib/client/note/NoteColors.js';
import { selectUserNotes, type UserNoteRow } from '../notes';
import { loadNoteCrypto, type NoteCrypto } from './crypto';
import type { McpCaller } from './oauth';
import { inScope, type McpScope } from './scope';

// The notes of the user an MCP client works for, decrypted for the length of one request. Only
// ever the caller's own notes: everything goes through `selectUserNotes(caller.userId)`, which
// only returns notes the user has access to, and is decrypted with their key. Of those, only the
// ones the user lets the app see (see `scope.ts`).

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
	/** Whether the user may change the note's text: theirs, or shared with them to edit. */
	canEdit: boolean;
	/** Whether the note is the user's own, so they can share it. */
	owned: boolean;
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

/** The colour id to store for a colour as the app names it, e.g. "blue" for "teal". */
export function colorId(name: string) {
	return Object.keys(COLOR_NAMES).find((id) => COLOR_NAMES[id] === name) ?? null;
}

/** A note's content as stored, decrypted. Fields other than these are kept as they are. */
export interface NoteData {
	content?: unknown;
	meta?: { color?: unknown; [key: string]: unknown };
	[key: string]: unknown;
}

/** A note of the caller, decrypted, with what's needed to change it. */
export interface DecryptedNote {
	row: UserNoteRow;
	noteKey: Uint8Array;
	data: NoteData;
	/** The caller's tags and hidden message. Null if they couldn't be decrypted. */
	userData: NoteUserData | null;
}

/**
 * Decrypts one of the caller's notes. Returns null for a deleted note, or one whose key or text
 * can't be decrypted. A note whose tags can't be decrypted is still there, without tags, like in
 * the app.
 */
export function decryptNote(
	crypto: NoteCrypto,
	caller: McpCaller,
	row: UserNoteRow
): DecryptedNote | null {
	if (row.deletedAt || !row.content) return null;
	let noteKey: Uint8Array;
	try {
		noteKey = crypto.openNoteKey(
			new Uint8Array(Buffer.from(row.noteKey, 'base64')),
			caller.publicKey,
			caller.privateKey
		);
	} catch {
		return null;
	}
	let data: NoteData;
	try {
		data = crypto.decryptJson(new Uint8Array(row.content as Buffer), noteKey) as NoteData;
	} catch {
		crypto.forget(noteKey);
		return null;
	}
	if (typeof data !== 'object' || data === null) {
		crypto.forget(noteKey);
		return null;
	}
	let userData: NoteUserData | null = { tags: {}, hiddenMessage: '' };
	if (row.tags) {
		try {
			userData = parseNoteUserData(crypto.decryptJson(new Uint8Array(row.tags as Buffer), noteKey));
		} catch {
			userData = null;
		}
	}
	return { row, noteKey, data, userData };
}

/** Whether the caller's app may see a decrypted note. */
export const noteInScope = (scope: McpScope, note: DecryptedNote) =>
	inScope(scope, {
		tags: note.userData && userTags(note.userData.tags),
		hidden: note.userData && isHidden(note.userData.tags)
	});

/** A decrypted note as MCP tools show it. */
export function toMcpNote(caller: McpCaller, { row, data, userData }: DecryptedNote): McpNote {
	const tags = userData?.tags ?? {};
	const html = typeof data.content === 'string' ? data.content : '';
	const text = htmlToText(html);
	let markdown: string;
	try {
		markdown = htmlToMarkdown(html);
	} catch {
		// Unusual HTML, e.g. from another app: the text is better than leaving the note out.
		markdown = text;
	}
	return {
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
		sharedBy: row.owner === caller.userId ? null : row.ownerUsername,
		canEdit: row.permissions === 'edit',
		owned: row.owner === caller.userId
	};
}

/**
 * Decrypts the caller's notes that their app may see. A note that can't be decrypted is
 * skipped, and only its id is reported, never anything of its content. Notes out of the app's
 * reach aren't reported at all.
 *
 * `allTagNames` are the tags of all the user's notes, also those out of reach, only so tags the
 * app gives notes can be spelled like the user's: never show them to the app.
 */
export async function loadNotes(caller: McpCaller) {
	const crypto = await loadNoteCrypto();
	const notes: McpNote[] = [];
	const skippedIds: string[] = [];
	const allTagNames = new Set<string>();
	for (const row of selectUserNotes(caller.userId).all()) {
		if (row.deletedAt || !row.content) continue;
		const note = decryptNote(crypto, caller, row);
		if (!note) {
			skippedIds.push(row.id);
			continue;
		}
		for (const tag of userTags(note.userData?.tags ?? {})) allTagNames.add(tag);
		if (noteInScope(caller.scope, note)) notes.push(toMcpNote(caller, note));
		crypto.forget(note.noteKey);
	}
	return { notes, skippedIds, allTagNames };
}

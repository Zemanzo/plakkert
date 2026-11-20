import { BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js';
import { db } from '../Database';
import { decryptNoteData, decryptNoteKey, decryptNoteUserData } from '../serialization/Serialize';
import { htmlToFormat } from '../serialization/TextAndMarkdown';
import { isArchived, isHidden, isTrashed, userTags } from '../tags/Tags';
import type { RuntimeUser } from '#lib/types.js';

// Exporting all notes at once, as Markdown files in a zip, optionally encrypted with a password.

// Notes are small, so workers wouldn't make it noticeably faster, and they'd need `blob:` URLs.
configure({ useWebWorkers: false });

export type ExportFolder = 'Notes' | 'Archive' | 'Trash';

export interface ExportedNote {
	markdown: string;
	folder: ExportFolder;
	tags: string[];
	color: string;
	createdAt: Date;
	updatedAt: Date;
	/** Whether its text is hidden while it's closed in the app. */
	hidden: boolean;
	/** Who shared it with the user, for notes of someone else. */
	sharedBy?: string;
}

/** At most this long, so names don't run into path length limits once unzipped. */
const MAX_NAME_LENGTH = 60;
// Names Windows doesn't allow for files, whatever their extension.
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A file name for a note, from its first line, e.g. "Shopping list". */
export function titleFileName(markdown: string) {
	const firstLine =
		markdown
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '') ?? '';
	const name = firstLine
		// Markdown that isn't part of the title: headings, lists, checkboxes, quotes and emphasis.
		.replace(/^(#+\s*|[-*+]\s+(\[[ xX]\]\s*)?|\d+\.\s+|>\s*)+/, '')
		.replace(/[*_`~]/g, '')
		// Characters that aren't allowed in file names on some systems.
		// eslint-disable-next-line no-control-regex
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
		.replace(/\s+/g, ' ')
		.slice(0, MAX_NAME_LENGTH)
		// Windows drops dots and spaces at the end.
		.replace(/[\s.]+$/, '')
		.trim();
	if (!name) return 'Untitled';
	return RESERVED_NAMES.test(name) ? `${name}_` : name;
}

/** A file name for a note that doesn't tell what it's about: when it was created. */
export function dateFileName(createdAt: Date) {
	const pad = (n: number) => String(n).padStart(2, '0');
	const d = createdAt;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/**
 * The note's details as YAML front matter, which many Markdown apps (e.g. Obsidian) read. The
 * values are JSON, which is valid YAML, so they don't need escaping of their own.
 */
export function frontMatter(note: ExportedNote) {
	const lines = [
		`tags: ${JSON.stringify(note.tags)}`,
		`color: ${JSON.stringify(note.color)}`,
		`created: ${JSON.stringify(note.createdAt.toISOString())}`,
		`updated: ${JSON.stringify(note.updatedAt.toISOString())}`
	];
	if (note.hidden) lines.push('hidden: true');
	if (note.sharedBy) lines.push(`shared_by: ${JSON.stringify(note.sharedBy)}`);
	return `---\n${lines.join('\n')}\n---\n\n`;
}

/**
 * The path of each note in the zip, in the same order. With `namesByDate`, names don't contain
 * any of the note's text, since a zip's file names aren't encrypted, even with a password.
 */
export function exportPaths(notes: ExportedNote[], namesByDate: boolean) {
	const used = new Set<string>();
	return notes.map((note) => {
		const name = namesByDate ? dateFileName(note.createdAt) : titleFileName(note.markdown);
		let path = `${note.folder}/${name}.md`;
		for (let i = 2; used.has(path.toLowerCase()); i++) path = `${note.folder}/${name} (${i}).md`;
		used.add(path.toLowerCase());
		return path;
	});
}

/**
 * Builds the zip. With a password, every file is encrypted with AES-256, which most archive tools
 * can open (e.g. 7-Zip), although not every built-in one.
 */
export async function buildExportZip(notes: ExportedNote[], password?: string) {
	const writer = new ZipWriter(
		new BlobWriter('application/zip'),
		password ? { password, encryptionStrength: 3 } : {}
	);
	// Oldest first, also for which one gets "(2)" when names are the same.
	const sorted = [...notes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	const paths = exportPaths(sorted, !!password);
	for (const [i, note] of sorted.entries()) {
		await writer.add(paths[i], new TextReader(frontMatter(note) + note.markdown), {
			lastModDate: note.updatedAt
		});
	}
	return writer.close();
}

type ExportingUser = Pick<RuntimeUser, 'id' | 'publicKeyUint8' | 'decodedPrivateKey'>;

/**
 * Decrypts all of the user's notes on this device, as Markdown. Notes that were changed on
 * another device are included as they were last synced.
 *
 * @returns The notes, and how many couldn't be decrypted.
 */
export async function collectNotesForExport(user: ExportingUser) {
	const noteKeys = await db.noteKeys.where({ userId: user.id }).toArray();
	const rows = await db.notes.bulkGet(noteKeys.map((noteKey) => noteKey.noteId));
	let failed = 0;
	const notes: ExportedNote[] = [];
	for (const [i, noteKey] of noteKeys.entries()) {
		const note = rows[i];
		if (!note || note.deletedAt) continue;
		try {
			const key = await decryptNoteKey(
				noteKey.encryptedKey,
				user.publicKeyUint8,
				user.decodedPrivateKey
			);
			const data = await decryptNoteData(note.data, key);
			const { tags } = noteKey.tags ? await decryptNoteUserData(noteKey.tags, key) : { tags: {} };
			notes.push({
				markdown: htmlToFormat(data.content, 'markdown'),
				folder: isTrashed(tags) ? 'Trash' : isArchived(tags) ? 'Archive' : 'Notes',
				tags: userTags(tags),
				color: data.meta.color,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				hidden: isHidden(tags),
				sharedBy: note.ownerId === user.id ? undefined : (note.ownerUsername ?? 'someone else')
			});
		} catch (error) {
			console.error(`Failed to export note ${note.id}`, error);
			failed++;
		}
	}
	return { notes, failed };
}

/**
 * Reads the notes from a Google Takeout of Google Keep. The zip has a JSON and
 * an HTML file for every note, in `Takeout/Keep/`; only the JSON is used. Only
 * the text, checklists, color and labels are brought over, not formatting or
 * images.
 */

import { DEFAULT_NOTE_COLOR, type NoteColor } from '../note/NoteColors';
import type { ImportedNote, Parser } from '.';
import { noteHtml } from './NoteHtml';
import { unzipFiles } from './Zip';

/** The parts of a note's JSON that are used. */
interface KeepNote {
	title?: string;
	color?: string;
	isTrashed?: boolean;
	isArchived?: boolean;
	textContent?: string;
	listContent?: { text?: string; isChecked?: boolean }[];
	labels?: { name?: string }[];
	/** Microseconds since the epoch. */
	createdTimestampUsec?: number;
	/** Microseconds since the epoch. */
	userEditedTimestampUsec?: number;
}

/** Keep's colors by the name in the JSON, which still uses the names of its older palette. */
const KEEP_COLORS: Record<string, NoteColor> = {
	RED: 'red',
	ORANGE: 'orange',
	YELLOW: 'yellow',
	GREEN: 'green',
	TEAL: 'blue',
	BLUE: 'sky',
	CERULEAN: 'sky',
	DARK_BLUE: 'sky',
	PURPLE: 'purple',
	PINK: 'pink',
	BROWN: 'sand',
	GRAY: 'gray'
};

function isKeepNote(value: unknown): value is KeepNote {
	if (typeof value !== 'object' || value === null) return false;
	const note = value as KeepNote;
	return (
		typeof note.createdTimestampUsec === 'number' &&
		(typeof note.textContent === 'string' || Array.isArray(note.listContent))
	);
}

/**
 * Converts the JSON of a Keep note.
 *
 * @returns null for notes in the trash, which aren't imported.
 * @throws If it isn't a Keep note.
 */
export function convertKeepNote(json: unknown): ImportedNote | null {
	if (!isKeepNote(json)) throw new Error('Not a Google Keep note');
	if (json.isTrashed) return null;

	// Dates are stored in whole milliseconds.
	const toMs = (usec: number) => Math.floor(usec / 1000);
	const createdAt = toMs(json.createdTimestampUsec!);
	return {
		content: noteHtml({
			title: json.title,
			text: json.textContent,
			items: (json.listContent ?? []).map((item) => ({
				text: item.text ?? '',
				checked: item.isChecked === true
			}))
		}),
		// The default color is white, which notes here don't have.
		color: KEEP_COLORS[json.color ?? ''] ?? DEFAULT_NOTE_COLOR,
		archived: json.isArchived === true,
		labels: (json.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
		createdAt,
		updatedAt: json.userEditedTimestampUsec ? toMs(json.userEditedTimestampUsec) : createdAt
	};
}

const isJson = (path: string) => path.toLowerCase().endsWith('.json');
const inKeepFolder = (path: string) => path.split('/').slice(0, -1).includes('Keep');

/**
 * Reads the notes from a Takeout zip. That may hold other Google products as
 * well, so only the JSON in the Keep folder is read, or all JSON if there's no
 * such folder, e.g. when only that folder was zipped again.
 */
export const parseKeepTakeout: Parser = (data, onProgress) => {
	let files = unzipFiles(data, (path) => isJson(path) && inKeepFolder(path));
	if (Object.keys(files).length === 0) files = unzipFiles(data, isJson);

	const paths = Object.keys(files);
	if (paths.length === 0) {
		throw new Error('There are no Google Keep notes in this file.');
	}

	const decoder = new TextDecoder();
	const result = { notes: [] as ImportedNote[], trashed: 0, failed: [] as string[] };
	paths.forEach((path, index) => {
		try {
			const note = convertKeepNote(JSON.parse(decoder.decode(files[path])));
			if (note) result.notes.push(note);
			else result.trashed++;
		} catch {
			result.failed.push(path.split('/').at(-1)!);
		}
		onProgress(index + 1, paths.length);
	});
	return result;
};

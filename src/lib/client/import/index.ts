/**
 * Importing notes from other apps. Each app is a source: its export is read in
 * a web worker (see `Import.worker.ts`), which turns it into `ImportedNote`s,
 * and those are then encrypted and saved like any other note (`ImportNotes.ts`).
 *
 * To add a source, add it to `IMPORT_SOURCES`, and its parser to the worker.
 */

import type { NoteColor } from '../note/NoteColors';

export const IMPORT_SOURCES = [
	{
		id: 'keep',
		name: 'Google Keep',
		description:
			'Import the .zip with your Keep notes from Google Takeout. Archived notes go to the archive, and notes in the trash are skipped.',
		/** Given to every imported note, so they're easy to find and to tidy up. */
		tag: 'Keep import',
		/** For the file picker. */
		accept: '.zip,application/zip'
	}
] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];
export type ImportSourceId = ImportSource['id'];

/** A note as read from another app, ready to be saved. */
export interface ImportedNote {
	/** HTML, as the editor stores it. See `NoteHtml.ts`. */
	content: string;
	color: NoteColor;
	archived: boolean;
	/** Milliseconds since the epoch. */
	createdAt: number;
	/** Milliseconds since the epoch. */
	updatedAt: number;
}

export interface ParseResult {
	notes: ImportedNote[];
	/** Notes that were in the trash, which aren't imported. */
	trashed: number;
	/** Names of the files that couldn't be read as a note. */
	failed: string[];
}

/** Reads an export. Runs in the worker, so it must not touch the page or the database. */
export type Parser = (
	data: Uint8Array,
	onProgress: (done: number, total: number) => void
) => ParseResult;

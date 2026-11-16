import { createNotes, type NewNote } from '../note/NotesCRUD';
import { ARCHIVED_TAG } from '../tags/Tags';
import type { RuntimeUser } from '#lib/types.js';
import type { ImportedNote, ImportSource, ImportSourceId, ParseResult } from '.';

export interface ImportRequest {
	source: ImportSourceId;
	file: File;
}

export type WorkerMessage =
	| { type: 'progress'; done: number; total: number }
	| { type: 'done'; result: ParseResult }
	| { type: 'error'; message: string };

export interface ImportProgress {
	step: 'reading' | 'saving';
	done: number;
	total: number;
}

export interface ImportSummary {
	imported: number;
	archived: number;
	/** Notes that were in the trash, which aren't imported. */
	trashed: number;
	/** Names of the files that couldn't be read as a note. */
	failed: string[];
}

/** Notes are saved in batches, to show progress and keep the page responsive. */
const BATCH_SIZE = 50;

function parseInWorker(
	source: ImportSourceId,
	file: File,
	onProgress: (done: number, total: number) => void
) {
	const worker = new Worker(new URL('./Import.worker.ts', import.meta.url), { type: 'module' });
	return new Promise<ParseResult>((resolve, reject) => {
		worker.onmessage = ({ data: message }: MessageEvent<WorkerMessage>) => {
			if (message.type === 'progress') onProgress(message.done, message.total);
			else if (message.type === 'done') resolve(message.result);
			else reject(new Error(message.message));
		};
		worker.onerror = (event) => {
			event.preventDefault();
			reject(new Error('The file couldn’t be read.'));
		};
		worker.postMessage({ source, file } satisfies ImportRequest);
	}).finally(() => worker.terminate());
}

function toNewNote(note: ImportedNote, source: ImportSource, now: number): NewNote {
	return {
		data: { content: note.content, meta: { color: note.color } },
		tags: { [source.tag]: now, ...(note.archived && { [ARCHIVED_TAG]: now }) },
		createdAt: new Date(note.createdAt),
		updatedAt: new Date(note.updatedAt)
	};
}

/**
 * Imports the notes in an export of another app. They're read in a worker,
 * and then encrypted and saved like notes made here, so they sync as usual.
 */
export async function importNotes(
	source: ImportSource,
	file: File,
	user: Pick<RuntimeUser, 'id' | 'publicKeyUint8'>,
	onProgress: (progress: ImportProgress) => void
): Promise<ImportSummary> {
	const { notes, trashed, failed } = await parseInWorker(source.id, file, (done, total) =>
		onProgress({ step: 'reading', done, total })
	);

	const now = Date.now();
	for (let start = 0; start < notes.length; start += BATCH_SIZE) {
		onProgress({ step: 'saving', done: start, total: notes.length });
		const batch = notes.slice(start, start + BATCH_SIZE);
		await createNotes(
			user,
			batch.map((note) => toNewNote(note, source, now))
		);
	}

	return {
		imported: notes.length,
		archived: notes.filter((note) => note.archived).length,
		trashed,
		failed
	};
}

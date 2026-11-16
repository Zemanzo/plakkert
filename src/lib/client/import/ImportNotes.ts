import { db } from '../Database';
import { createNotes } from '../note/NotesCRUD';
import { loadTagNames } from '../tags/TagsCRUD';
import type { RuntimeUser } from '#lib/types.js';
import type { ImportSource, ImportSourceId, ParseResult } from '.';
import { planImport, type ImportPlan } from './ImportPlan';

export interface ImportRequest {
	source: ImportSourceId;
	file: File;
}

export type WorkerMessage =
	| { type: 'progress'; done: number; total: number }
	| { type: 'done'; result: ParseResult }
	| { type: 'error'; message: string };

type ImportingUser = Pick<RuntimeUser, 'id' | 'publicKeyUint8' | 'decodedPrivateKey'>;

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

/** When the user's notes were created, to recognize notes that were imported before. */
async function loadCreatedAt(userId: string, notes: ParseResult['notes']) {
	const dates = [...new Set(notes.map((note) => note.createdAt))].map((ms) => new Date(ms));
	const existing = await db.notes.where('createdAt').anyOf(dates).toArray();
	return new Set(
		existing
			.filter((note) => note.ownerId === userId && !note.deletedAt)
			.map((note) => note.createdAt.getTime())
	);
}

/**
 * Reads an export of another app, in a worker, and works out what importing
 * it will do. Nothing is saved yet: see `saveImport`.
 */
export async function prepareImport(
	source: ImportSource,
	file: File,
	user: ImportingUser,
	onProgress: (done: number, total: number) => void
): Promise<ImportPlan> {
	const parsed = await parseInWorker(source.id, file, onProgress);
	const [tagNames, createdAt] = await Promise.all([
		loadTagNames(user),
		loadCreatedAt(user.id, parsed.notes)
	]);
	return planImport(source, parsed, tagNames, createdAt);
}

/** Saves the notes of a confirmed import. They're encrypted and synced like notes made here. */
export async function saveImport(
	plan: ImportPlan,
	user: ImportingUser,
	onProgress: (done: number, total: number) => void
) {
	for (let start = 0; start < plan.notes.length; start += BATCH_SIZE) {
		onProgress(start, plan.notes.length);
		await createNotes(user, plan.notes.slice(start, start + BATCH_SIZE));
	}
}

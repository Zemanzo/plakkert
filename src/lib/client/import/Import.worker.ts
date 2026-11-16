/**
 * Reads an export off the main thread, so a large one doesn't freeze the page.
 * See `ImportNotes.ts` for the messages.
 */

import type { ImportSourceId, Parser } from '.';
import type { ImportRequest, WorkerMessage } from './ImportNotes';
import { parseKeepTakeout } from './KeepImport';

const parsers = {
	keep: parseKeepTakeout
} satisfies Record<ImportSourceId, Parser>;

const post = (message: WorkerMessage) => self.postMessage(message);

self.onmessage = async ({ data: { source, file } }: MessageEvent<ImportRequest>) => {
	try {
		const data = new Uint8Array(await file.arrayBuffer());
		const result = parsers[source](data, (done, total) => post({ type: 'progress', done, total }));
		post({ type: 'done', result });
	} catch (error) {
		post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
};

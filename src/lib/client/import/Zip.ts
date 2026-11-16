import { unzipSync } from 'fflate';

/**
 * Unpacks the files in a zip whose path matches `filter`. Other files aren't
 * decompressed at all, which matters for a Takeout that holds more than Keep.
 *
 * @returns The files' contents by path.
 */
export function unzipFiles(data: Uint8Array, filter: (path: string) => boolean) {
	try {
		return unzipSync(data, { filter: (file) => !file.name.endsWith('/') && filter(file.name) });
	} catch (error) {
		throw new Error('This file isn’t a .zip file, or it’s damaged.', { cause: error });
	}
}

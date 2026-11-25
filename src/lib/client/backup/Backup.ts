import { strFromU8, unzipSync } from 'fflate';
import {
	BACKUP_FILES,
	BACKUP_FORMAT,
	BACKUP_VERSION,
	MAX_BACKUP_BYTES,
	type BackupManifest,
	type RestoreSummary
} from '#lib/backup.js';
import { ApiError, request } from '../Api';
import { downloadBlob } from '../serialization/TextAndMarkdown';

// Backups in the app: downloading one, and restoring one by uploading it in pieces. The server
// makes and reads them; see src/lib/server/backup.ts.

/** Where the user's backup downloads from, as a zip. */
export const BACKUP_DOWNLOAD_PATH = '/api/user/backup';

/** Downloads the user's backup as a file, as the server has it now. */
export async function downloadBackup() {
	const response = await request(BACKUP_DOWNLOAD_PATH);
	const name =
		/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
		'plakkert-backup.zip';
	downloadBlob(await response.blob(), name);
}

/** Thrown when a file isn't a backup this app can restore. */
export class BackupFileError extends Error {}

/** Reads the manifest of a backup, to know whose it is before restoring it. */
export function readBackupManifest(zip: Uint8Array): BackupManifest {
	if (zip.length > MAX_BACKUP_BYTES) {
		throw new BackupFileError('This backup is too big to restore.');
	}
	let manifest: Partial<BackupManifest>;
	try {
		const files = unzipSync(zip, { filter: (file) => file.name === BACKUP_FILES.manifest });
		manifest = JSON.parse(strFromU8(files[BACKUP_FILES.manifest]));
	} catch {
		throw new BackupFileError('This isn’t a Plakkert backup.');
	}
	if (manifest.format !== BACKUP_FORMAT || !manifest.user) {
		throw new BackupFileError('This isn’t a Plakkert backup.');
	}
	if (manifest.version !== BACKUP_VERSION) {
		throw new BackupFileError('This backup was made by a newer version of Plakkert.');
	}
	return manifest as BackupManifest;
}

/**
 * Uploads a backup and restores it into the logged-in user's account, by merging it. Uploads go in
 * pieces, as the server takes no big requests.
 *
 * @param onProgress Called with the bytes uploaded so far, and in all.
 */
export async function restoreBackup(
	zip: Uint8Array,
	onProgress?: (sent: number, total: number) => void
): Promise<RestoreSummary> {
	const response = await request('/api/user/backup/uploads', { method: 'POST' });
	const { token, chunkSize } = (await response.json()) as { token: string; chunkSize: number };

	for (let offset = 0; offset < zip.length; offset += chunkSize) {
		onProgress?.(offset, zip.length);
		await request(`/api/backup/uploads/${token}?offset=${offset}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/octet-stream' },
			body: zip.slice(offset, offset + chunkSize)
		});
	}
	onProgress?.(zip.length, zip.length);

	const restored = await request('/api/user/backup/restore', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ upload: token })
	});
	return (await restored.json()) as RestoreSummary;
}

/** A message for an error while restoring. */
export function restoreErrorMessage(error: unknown) {
	if (error instanceof BackupFileError) return error.message;
	if (error instanceof ApiError && error.status !== 500) return error.message;
	return 'The backup couldn’t be restored. Are you online?';
}

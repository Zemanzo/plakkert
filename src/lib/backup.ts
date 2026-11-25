// Backups: a lossless copy of a user's data on the server, still encrypted, as a zip. Shared by
// the app and the server. See `src/lib/server/backup.ts`.

/** What `manifest.json` in a backup says it is. */
export const BACKUP_FORMAT = 'plakkert-backup';
export const BACKUP_VERSION = 1;

/** The files in a backup, one per table, like the server's database. */
export const BACKUP_FILES = {
	manifest: 'manifest.json',
	notes: 'notes.json',
	userNotes: 'user_notes.json',
	noteVersions: 'note_versions.json',
	userSettings: 'user_settings.json',
	noteHistory: 'note_history.json'
} as const;

/**
 * Uploads are sent in pieces of at most this many bytes, as the server takes no bigger requests
 * (adapter-node's BODY_SIZE_LIMIT is 512 KB by default).
 */
export const BACKUP_CHUNK_BYTES = 256 * 1024;

/** The biggest backup that can be restored. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/**
 * The user a backup is of, with their keys as the server stores them: the private key encrypted
 * with the password they had when the backup was made. Binary fields are base64.
 */
export interface BackupUser {
	id: string;
	username: string;
	publicKey: string;
	privateKey: string;
	salt: string;
	nonce: string;
	kdfIterations: number;
	/** Milliseconds since the epoch. */
	createdAt: number;
}

export interface BackupManifest {
	format: typeof BACKUP_FORMAT;
	version: number;
	/** Milliseconds since the epoch. */
	exportedAt: number;
	/** The server it came from. */
	origin: string | null;
	user: BackupUser;
}

/** What restoring a backup did. */
export interface RestoreSummary {
	/** Notes that were missing or deleted, and are back. */
	restored: number;
	/** Notes that were older than in the backup, and were replaced. */
	updated: number;
	/** Notes whose tags were older than in the backup. */
	retagged: number;
	versions: number;
	shares: number;
	settings: boolean;
	/** Notes in the backup that were deleted then too, and stay deleted. */
	skippedDeleted: number;
}

/** A restore summary in a sentence. */
export function describeRestore(summary: RestoreSummary) {
	const notes = (count: number) => (count === 1 ? '1 note' : `${count} notes`);
	const parts = [
		summary.restored > 0 && `brought back ${notes(summary.restored)}`,
		summary.updated > 0 && `updated ${notes(summary.updated)} to the backup's newer text`,
		summary.retagged > 0 && `restored the tags of ${notes(summary.retagged)}`,
		summary.versions > 0 &&
			`added ${summary.versions === 1 ? '1 earlier version' : `${summary.versions} earlier versions`}`,
		summary.shares > 0 &&
			`restored ${summary.shares === 1 ? '1 share' : `${summary.shares} shares`} with others`,
		summary.settings && 'restored your settings'
	].filter(Boolean);
	if (parts.length === 0) return 'Everything in the backup was already there.';
	const sentence = parts.join(', ');
	return sentence[0].toUpperCase() + sentence.slice(1) + '.';
}

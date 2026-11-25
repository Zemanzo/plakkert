import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { BACKUP_CHUNK_BYTES, MAX_BACKUP_BYTES } from '#lib/backup.js';
import { db } from './db/index';
import { mcpAccess, oauthGrants } from './db/schema';

// Moving backups in and out, by links that hold a secret token: for the app, and for MCP clients,
// which can download from and upload to a link with their own tools (e.g. curl), but can't use
// the user's session or hand over their access token. Links expire, and are kept in memory, which
// is enough for a single server process. A restart forgets them; the client then starts again.

/** How long a link works. Long enough to upload a big backup over a slow connection. */
export const TRANSFER_MS = 30 * 60 * 1000;
/** At most this many uploads and downloads per user at once; starting another drops the oldest. */
const MAX_PER_USER = 3;

interface Transfer {
	userId: string;
	expiresAt: number;
}

interface Upload extends Transfer {
	chunks: Buffer[];
	size: number;
}

interface Download extends Transfer {
	grantId: string;
}

const uploads = new Map<string, Upload>();
const downloads = new Map<string, Download>();

function newToken() {
	return randomBytes(32).toString('base64url');
}

/** Forgets expired transfers, and the user's oldest ones beyond `MAX_PER_USER`. */
function makeRoom<T extends Transfer>(transfers: Map<string, T>, userId: string, now: number) {
	for (const [token, transfer] of transfers) {
		if (transfer.expiresAt <= now) transfers.delete(token);
	}
	// Maps keep insertion order, so the first ones are the oldest.
	const own = [...transfers].filter(([, transfer]) => transfer.userId === userId);
	for (const [token] of own.slice(0, Math.max(0, own.length - MAX_PER_USER + 1))) {
		transfers.delete(token);
	}
}

function find<T extends Transfer>(transfers: Map<string, T>, token: string, now = Date.now()) {
	const transfer = transfers.get(token);
	if (!transfer) return null;
	if (transfer.expiresAt <= now) {
		transfers.delete(token);
		return null;
	}
	return transfer;
}

/** Starts an upload of a backup for the user, returning its token. */
export function startUpload(userId: string, now = Date.now()) {
	makeRoom(uploads, userId, now);
	const token = newToken();
	uploads.set(token, { userId, expiresAt: now + TRANSFER_MS, chunks: [], size: 0 });
	return token;
}

export type AppendResult =
	| { status: 200; size: number }
	| { status: 404 }
	| { status: 409; size: number }
	| { status: 413; message: string };

/**
 * Adds a piece of an upload. `offset` must be the size so far, so a piece sent twice, e.g. when a
 * client retries, isn't added twice: then it's refused with the size, to go on from there.
 */
export function appendUpload(token: string, offset: number, chunk: Buffer): AppendResult {
	const upload = find(uploads, token);
	if (!upload) return { status: 404 };
	if (offset !== upload.size) return { status: 409, size: upload.size };
	if (chunk.length > BACKUP_CHUNK_BYTES) {
		return { status: 413, message: `Send at most ${BACKUP_CHUNK_BYTES} bytes at once` };
	}
	if (upload.size + chunk.length > MAX_BACKUP_BYTES) {
		return { status: 413, message: `A backup can be at most ${MAX_BACKUP_BYTES} bytes` };
	}
	upload.chunks.push(chunk);
	upload.size += chunk.length;
	return { status: 200, size: upload.size };
}

/** The whole upload, if it's the user's, after which the link no longer works. */
export function takeUpload(token: string, userId: string): Uint8Array | null {
	const upload = find(uploads, token);
	if (!upload || upload.userId !== userId) return null;
	uploads.delete(token);
	return new Uint8Array(Buffer.concat(upload.chunks));
}

/**
 * Starts a download of the user's backup for an MCP client, returning its token. The backup is
 * made when it's downloaded. The link stops working if the user takes the client's access away.
 */
export function startDownload(userId: string, grantId: string, now = Date.now()) {
	makeRoom(downloads, userId, now);
	const token = newToken();
	downloads.set(token, { userId, grantId, expiresAt: now + TRANSFER_MS });
	return token;
}

/** Whose backup a download link is for, while it works and its client still has access. */
export function findDownload(token: string) {
	const download = find(downloads, token);
	if (!download) return null;
	const grant = db
		.select({ id: oauthGrants.id })
		.from(oauthGrants)
		.innerJoin(mcpAccess, eq(mcpAccess.userId, oauthGrants.userId))
		.where(and(eq(oauthGrants.id, download.grantId), eq(oauthGrants.userId, download.userId)))
		.get();
	return grant ? download.userId : null;
}

/** The links, by the app's origin. */
export const uploadUrl = (origin: string, token: string) => `${origin}/api/backup/uploads/${token}`;
export const downloadUrl = (origin: string, token: string) =>
	`${origin}/api/backup/downloads/${token}`;

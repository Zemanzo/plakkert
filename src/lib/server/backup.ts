import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import {
	BACKUP_FILES,
	BACKUP_FORMAT,
	BACKUP_VERSION,
	type BackupManifest,
	type RestoreSummary
} from '#lib/backup.js';
import { takeUpload } from './backupTransfers';
import { db } from './db/index';
import { noteHistory, notes, noteVersions, user, userNotes, userSettings } from './db/schema';
import { historySince, keepPreviousVersion, thinOut } from './history';
import { changeStamp, isClientTime } from './notes';

// Backups: a lossless copy of a user's data on the server, as a zip of JSON files, one per table.
// Everything stays as encrypted as it's stored: the server can't read a backup any more than the
// database. Only the user's own: their notes, with their history, their own access to them, who
// they shared them with (but not those people's tags), their settings, and whether they keep
// history. Not notes others shared with them, nor sessions, passwords or MCP grants.
//
// Restoring merges: what's missing or deleted comes back, what's older is replaced, and nothing is
// deleted. See `restoreBackup`.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const base64 = (value: unknown) => (value ? (value as Buffer).toString('base64') : null);
const time = (value: Date | null) => (value ? value.getTime() : null);

/** Makes the backup of a user's data, as a zip. */
export function exportBackup(userId: string, origin: string | null): Uint8Array {
	// In a transaction, so the tables are copied as they were at one moment.
	const files = db.transaction((tx) => {
		const owner = tx
			.select({
				id: user.id,
				username: user.username,
				publicKey: user.publicKey,
				privateKey: user.privateKey,
				salt: user.salt,
				nonce: user.nonce,
				kdfIterations: user.kdfIterations,
				createdAt: user.createdAt
			})
			.from(user)
			.where(eq(user.id, userId))
			.get();
		if (!owner) throw new Error('No such user');

		const manifest: BackupManifest = {
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			exportedAt: Date.now(),
			origin,
			user: { ...owner, createdAt: owner.createdAt.getTime() }
		};

		const ownNotes = tx.select().from(notes).where(eq(notes.owner, userId)).all();
		const access = tx
			.select({ access: userNotes, username: user.username, publicKey: user.publicKey })
			.from(userNotes)
			.innerJoin(notes, eq(userNotes.noteId, notes.id))
			.innerJoin(user, eq(userNotes.userId, user.id))
			.where(eq(notes.owner, userId))
			.all();
		const versions = tx
			.select({ version: noteVersions })
			.from(noteVersions)
			.innerJoin(notes, eq(noteVersions.noteId, notes.id))
			.where(eq(notes.owner, userId))
			.all();
		const settings = tx.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
		const history = tx.select().from(noteHistory).where(eq(noteHistory.userId, userId)).get();

		return {
			[BACKUP_FILES.manifest]: manifest,
			[BACKUP_FILES.notes]: ownNotes.map((note) => ({
				id: note.id,
				content: base64(note.content),
				createdAt: note.createdAt.getTime(),
				updatedAt: note.updatedAt.getTime(),
				deletedAt: time(note.deletedAt),
				changedAt: note.changedAt
			})),
			[BACKUP_FILES.userNotes]: access.map(({ access: row, username, publicKey }) => {
				const own = row.userId === userId;
				return {
					userId: row.userId,
					username,
					publicKey,
					noteId: row.noteId,
					noteKey: row.noteKey,
					permissions: row.permissions,
					// Other people's tags are theirs, so only the user's own are in their backup.
					tags: own ? base64(row.tags) : null,
					tagsUpdatedAt: own ? time(row.tagsUpdatedAt) : null,
					changedAt: row.changedAt,
					createdAt: row.createdAt.getTime()
				};
			}),
			[BACKUP_FILES.noteVersions]: versions.map(({ version }) => ({
				noteId: version.noteId,
				updatedAt: version.updatedAt.getTime(),
				content: base64(version.content),
				createdAt: version.createdAt.getTime()
			})),
			[BACKUP_FILES.userSettings]: settings
				? {
						content: base64(settings.content),
						updatedAt: settings.updatedAt.getTime(),
						changedAt: settings.changedAt
					}
				: null,
			[BACKUP_FILES.noteHistory]: history ? { enabledAt: history.enabledAt } : null
		};
	});

	return zipSync(
		Object.fromEntries(
			Object.entries(files).map(([name, value]) => [name, strToU8(JSON.stringify(value))])
		)
	);
}

/** The user's backup as a download, named after today. Never cached along the way. */
export function backupResponse(userId: string, origin: string | null) {
	const zip = exportBackup(userId, origin);
	const date = new Date().toISOString().slice(0, 10);
	return new Response(new Uint8Array(zip), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="plakkert-backup-${date}.zip"`,
			'Content-Length': String(zip.length),
			'Cache-Control': 'no-store'
		}
	});
}

// --- Reading a backup ---

const MAX_BLOB = 16 * 1024 * 1024;
const blob = z
	.string()
	.max(MAX_BLOB)
	.regex(/^[A-Za-z0-9+/]*={0,2}$/);
const id = z.string().min(1).max(100);
const timestamp = z.number().int().min(0);
/** A time that orders changes: never far ahead, as it would win over every later change. */
const changeTime = timestamp.refine((value) => isClientTime(value), 'Too far in the future');

const manifestSchema = z.object({
	format: z.literal(BACKUP_FORMAT),
	version: z.literal(BACKUP_VERSION),
	exportedAt: timestamp,
	origin: z.string().nullable(),
	user: z.object({
		id,
		username: z.string().min(1).max(100),
		publicKey: blob,
		privateKey: blob,
		salt: blob,
		nonce: blob,
		kdfIterations: z.number().int().positive(),
		createdAt: timestamp
	})
});

const backupSchema = z.object({
	manifest: manifestSchema,
	notes: z.array(
		z.object({
			id,
			content: blob.nullable(),
			createdAt: timestamp,
			updatedAt: changeTime,
			deletedAt: timestamp.nullable(),
			changedAt: z.number().int()
		})
	),
	userNotes: z.array(
		z.object({
			userId: id,
			username: z.string().min(1).max(100),
			publicKey: blob,
			noteId: id,
			noteKey: z.string().min(1).max(4096),
			permissions: z.enum(['view', 'edit']),
			tags: blob.nullable(),
			tagsUpdatedAt: changeTime.nullable(),
			changedAt: z.number().int(),
			createdAt: timestamp
		})
	),
	noteVersions: z.array(
		z.object({ noteId: id, updatedAt: timestamp, content: blob, createdAt: timestamp })
	),
	userSettings: z
		.object({ content: blob, updatedAt: changeTime, changedAt: z.number().int() })
		.nullable(),
	noteHistory: z.object({ enabledAt: z.number().int() }).nullable()
});

export type Backup = z.infer<typeof backupSchema>;

/** How much a backup may unpack to, against zip bombs. */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/** Reads a backup zip, or says what's wrong with it. */
export function parseBackup(zip: Uint8Array): Backup | { problem: string } {
	const names = new Set<string>(Object.values(BACKUP_FILES));
	let unpacked = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(zip, {
			filter: (file) => {
				if (!names.has(file.name)) return false;
				unpacked += file.originalSize;
				if (unpacked > MAX_UNPACKED_BYTES) throw new Error('Too big');
				return true;
			}
		});
	} catch {
		return { problem: 'This isn’t a Plakkert backup: it isn’t a zip, or it’s damaged.' };
	}

	const read = (name: string) => {
		const file = files[name];
		if (!file) throw new Error(`${name} is missing`);
		return JSON.parse(strFromU8(file));
	};
	let raw: Record<string, unknown>;
	try {
		raw = {
			manifest: read(BACKUP_FILES.manifest),
			notes: read(BACKUP_FILES.notes),
			userNotes: read(BACKUP_FILES.userNotes),
			noteVersions: read(BACKUP_FILES.noteVersions),
			userSettings: read(BACKUP_FILES.userSettings),
			noteHistory: read(BACKUP_FILES.noteHistory)
		};
	} catch {
		return { problem: 'This isn’t a Plakkert backup: files in it are missing or damaged.' };
	}
	const manifest = manifestSchema.safeParse(raw.manifest);
	if (!manifest.success) {
		return (raw.manifest as { format?: unknown })?.format === BACKUP_FORMAT
			? { problem: 'This backup was made by a newer version of Plakkert.' }
			: { problem: 'This isn’t a Plakkert backup.' };
	}
	const backup = backupSchema.safeParse(raw);
	return backup.success ? backup.data : { problem: 'This backup is damaged.' };
}

// --- Restoring ---

/**
 * The id a note gets when its own is taken by another user's note, e.g. when a backup is restored
 * into a second account on the same server. Always the same for the same user and note, so
 * restoring twice merges instead of making copies.
 */
export function remapNoteId(userId: string, noteId: string) {
	const hex = createHash('sha256').update(`${userId}:${noteId}`).digest('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type RestoreResult =
	{ status: 200; summary: RestoreSummary } | { status: 409; message: string; code: 'OTHER_KEYS' };

const bytes = (value: string) => Buffer.from(value, 'base64');

/**
 * Merges a backup into the user's data. The user must have the backup's key pair, as everything
 * in it is encrypted for that.
 *
 * - Notes that are missing or deleted come back, with the user's tags, and shared again with the
 *   people they were shared with, if those still have the same key. Notes that were deleted
 *   when the backup was made stay deleted.
 * - Notes that are older than in the backup get the backup's text; what they had is kept as a
 *   version, if the user keeps history. Tags and settings likewise take whichever is newer.
 * - Versions in the backup are added, if the user keeps history. An account without notes takes
 *   the backup's choice of keeping history.
 *
 * Everything that changes is marked as changed, so the user's devices, and the people notes are
 * shared with, pick it up on their next sync.
 */
export function restoreBackup(userId: string, backup: Backup): RestoreResult {
	return db.transaction((tx): RestoreResult => {
		const account = tx
			.select({ publicKey: user.publicKey })
			.from(user)
			.where(eq(user.id, userId))
			.get();
		if (!account || account.publicKey !== backup.manifest.user.publicKey) {
			return {
				status: 409,
				code: 'OTHER_KEYS',
				message:
					'This backup is of another account. To restore it, create a new account from it, on the register page.'
			};
		}

		const summary: RestoreSummary = {
			restored: 0,
			updated: 0,
			retagged: 0,
			versions: 0,
			shares: 0,
			settings: false,
			skippedDeleted: 0
		};

		const hasNotes = tx.select({ id: notes.id }).from(notes).where(eq(notes.owner, userId)).get();
		let keepsHistory = historySince(userId, tx) !== null;
		if (!hasNotes && !keepsHistory && backup.noteHistory) {
			tx.insert(noteHistory).values({ userId, enabledAt: changeStamp() }).run();
			keepsHistory = true;
		}

		const backupUserId = backup.manifest.user.id;
		const ownAccess = new Map(
			backup.userNotes.filter((row) => row.userId === backupUserId).map((row) => [row.noteId, row])
		);
		const sharesOf = Map.groupBy(
			backup.userNotes.filter((row) => row.userId !== backupUserId),
			(row) => row.noteId
		);
		const versionsOf = Map.groupBy(backup.noteVersions, (version) => version.noteId);

		for (const note of backup.notes) {
			const access = ownAccess.get(note.id);
			if (!access) continue;
			if (note.deletedAt !== null || note.content === null) {
				summary.skippedDeleted++;
				continue;
			}

			let noteId = note.id;
			let stored = tx.select().from(notes).where(eq(notes.id, noteId)).get();
			if (stored && stored.owner !== userId) {
				noteId = remapNoteId(userId, note.id);
				stored = tx.select().from(notes).where(eq(notes.id, noteId)).get();
				if (stored && stored.owner !== userId) continue;
			}
			const content = bytes(note.content);
			const tags = access.tags === null ? null : bytes(access.tags);
			const tagsUpdatedAt = access.tagsUpdatedAt === null ? null : new Date(access.tagsUpdatedAt);
			const ownRow = { tags, tagsUpdatedAt, changedAt: changeStamp() };

			if (!stored || stored.deletedAt) {
				if (!stored) {
					tx.insert(notes)
						.values({
							id: noteId,
							owner: userId,
							content,
							createdAt: new Date(note.createdAt),
							updatedAt: new Date(note.updatedAt),
							changedAt: changeStamp()
						})
						.run();
				} else {
					tx.update(notes)
						.set({
							content,
							updatedAt: new Date(note.updatedAt),
							deletedAt: null,
							changedAt: changeStamp()
						})
						.where(eq(notes.id, noteId))
						.run();
				}
				tx.insert(userNotes)
					.values({ userId, noteId, noteKey: access.noteKey, permissions: 'edit', ...ownRow })
					.onConflictDoUpdate({ target: [userNotes.userId, userNotes.noteId], set: ownRow })
					.run();
				summary.shares += restoreShares(tx, userId, noteId, sharesOf.get(note.id) ?? []);
				summary.restored++;
			} else {
				if (note.updatedAt > stored.updatedAt.getTime()) {
					keepPreviousVersion(tx, stored, new Date(note.updatedAt), 'always');
					tx.update(notes)
						.set({ content, updatedAt: new Date(note.updatedAt), changedAt: changeStamp() })
						.where(eq(notes.id, noteId))
						.run();
					summary.updated++;
				}
				const current = tx
					.select({ tagsUpdatedAt: userNotes.tagsUpdatedAt })
					.from(userNotes)
					.where(and(eq(userNotes.userId, userId), eq(userNotes.noteId, noteId)))
					.get();
				if (
					!current ||
					(tagsUpdatedAt && (!current.tagsUpdatedAt || tagsUpdatedAt > current.tagsUpdatedAt))
				) {
					tx.insert(userNotes)
						.values({ userId, noteId, noteKey: access.noteKey, permissions: 'edit', ...ownRow })
						.onConflictDoUpdate({ target: [userNotes.userId, userNotes.noteId], set: ownRow })
						.run();
					summary.retagged++;
				}
			}

			if (keepsHistory) {
				for (const version of versionsOf.get(note.id) ?? []) {
					summary.versions += tx
						.insert(noteVersions)
						.values({
							noteId,
							updatedAt: new Date(version.updatedAt),
							content: bytes(version.content),
							createdAt: new Date(version.createdAt)
						})
						.onConflictDoNothing()
						.run().changes;
				}
				thinOut(tx, noteId);
			}
		}

		const settings = backup.userSettings;
		if (settings) {
			const current = tx
				.select({ updatedAt: userSettings.updatedAt })
				.from(userSettings)
				.where(eq(userSettings.userId, userId))
				.get();
			if (!current || settings.updatedAt > current.updatedAt.getTime()) {
				const values = {
					content: bytes(settings.content),
					updatedAt: new Date(settings.updatedAt),
					changedAt: changeStamp()
				};
				tx.insert(userSettings)
					.values({ userId, ...values })
					.onConflictDoUpdate({ target: userSettings.userId, set: values })
					.run();
				summary.settings = true;
			}
		}

		return { status: 200, summary };
	});
}

export type UploadRestoreResult =
	| { status: 200; summary: RestoreSummary }
	| { status: 400 | 404 | 409; message: string; code?: string };

/** Restores the backup that was uploaded with `token`, which must be the user's own upload. */
export function restoreUpload(token: string, userId: string): UploadRestoreResult {
	const zip = takeUpload(token, userId);
	if (!zip) {
		return {
			status: 404,
			message: 'There’s no such upload, or it expired. Start the upload again.',
			code: 'NO_UPLOAD'
		};
	}
	const backup = parseBackup(zip);
	if ('problem' in backup) return { status: 400, message: backup.problem, code: 'BAD_BACKUP' };
	return restoreBackup(userId, backup);
}

/**
 * Shares a note that was brought back again, with the people it was shared with: only those who
 * still have the key it was shared with, so it can't reach someone who took over their username.
 */
function restoreShares(
	tx: Transaction,
	userId: string,
	noteId: string,
	shares: Backup['userNotes']
) {
	let restored = 0;
	for (const share of shares) {
		const recipient = tx
			.select({ id: user.id, publicKey: user.publicKey })
			.from(user)
			.where(eq(user.username, share.username))
			.get();
		if (!recipient || recipient.id === userId || recipient.publicKey !== share.publicKey) continue;
		restored += tx
			.insert(userNotes)
			.values({
				userId: recipient.id,
				noteId,
				noteKey: share.noteKey,
				permissions: share.permissions,
				changedAt: changeStamp()
			})
			.onConflictDoNothing()
			.run().changes;
	}
	return restored;
}

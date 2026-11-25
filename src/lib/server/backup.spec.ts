import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { BACKUP_CHUNK_BYTES, BACKUP_FILES, BACKUP_FORMAT, BACKUP_VERSION } from '#lib/backup.js';
import { parseBackup, remapNoteId } from './backup';
import { appendUpload, startUpload, takeUpload } from './backupTransfers';

const now = Date.now();

function backupFiles(overrides: Record<string, unknown> = {}) {
	const files: Record<string, unknown> = {
		[BACKUP_FILES.manifest]: {
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			exportedAt: now,
			origin: 'https://notes.example.com',
			user: {
				id: 'user-1',
				username: 'alice',
				publicKey: 'cHVibGlj',
				privateKey: 'cHJpdmF0ZQ==',
				salt: 'c2FsdA==',
				nonce: 'bm9uY2U=',
				kdfIterations: 600_000,
				createdAt: now - 1000
			}
		},
		[BACKUP_FILES.notes]: [
			{
				id: 'note-1',
				content: 'ZW5jcnlwdGVk',
				createdAt: now - 500,
				updatedAt: now - 100,
				deletedAt: null,
				changedAt: 42
			}
		],
		[BACKUP_FILES.userNotes]: [
			{
				userId: 'user-1',
				username: 'alice',
				publicKey: 'cHVibGlj',
				noteId: 'note-1',
				noteKey: 'a2V5',
				permissions: 'edit',
				tags: null,
				tagsUpdatedAt: null,
				changedAt: 42,
				createdAt: now - 500
			}
		],
		[BACKUP_FILES.noteVersions]: [],
		[BACKUP_FILES.userSettings]: null,
		[BACKUP_FILES.noteHistory]: { enabledAt: 7 },
		...overrides
	};
	return zipSync(
		Object.fromEntries(
			Object.entries(files)
				.filter(([, value]) => value !== undefined)
				.map(([name, value]) => [name, strToU8(JSON.stringify(value))])
		)
	);
}

describe('parseBackup', () => {
	it('reads a backup', () => {
		const backup = parseBackup(backupFiles());
		expect(backup).not.toHaveProperty('problem');
		expect(backup).toMatchObject({
			manifest: { user: { username: 'alice' } },
			notes: [{ id: 'note-1', content: 'ZW5jcnlwdGVk' }],
			noteHistory: { enabledAt: 7 }
		});
	});

	it('refuses what isn’t a backup', () => {
		expect(parseBackup(strToU8('not a zip'))).toHaveProperty('problem');
		expect(parseBackup(zipSync({ 'notes.md': strToU8('# Hi') }))).toHaveProperty('problem');
		expect(parseBackup(backupFiles({ [BACKUP_FILES.notes]: undefined }))).toHaveProperty('problem');
	});

	it('says so when a backup is from a newer version', () => {
		const newer = backupFiles({
			[BACKUP_FILES.manifest]: { format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }
		});
		expect(parseBackup(newer)).toEqual({
			problem: 'This backup was made by a newer version of Plakkert.'
		});
	});

	it('refuses times far in the future, which would win over every later change', () => {
		const future = backupFiles({
			[BACKUP_FILES.notes]: [
				{
					id: 'note-1',
					content: 'ZW5jcnlwdGVk',
					createdAt: now,
					updatedAt: now + 365 * 24 * 60 * 60 * 1000,
					deletedAt: null,
					changedAt: 0
				}
			]
		});
		expect(parseBackup(future)).toHaveProperty('problem');
	});

	it('refuses content that isn’t base64', () => {
		const broken = backupFiles({
			[BACKUP_FILES.notes]: [
				{
					id: 'note-1',
					content: 'not base64!',
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
					changedAt: 0
				}
			]
		});
		expect(parseBackup(broken)).toHaveProperty('problem');
	});
});

describe('remapNoteId', () => {
	it('gives the same id for the same user and note, and others otherwise', () => {
		expect(remapNoteId('bob', 'note-1')).toBe(remapNoteId('bob', 'note-1'));
		expect(remapNoteId('bob', 'note-1')).not.toBe(remapNoteId('carol', 'note-1'));
		expect(remapNoteId('bob', 'note-1')).not.toBe(remapNoteId('bob', 'note-2'));
		expect(remapNoteId('bob', 'note-1')).toMatch(/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/);
	});
});

describe('uploads', () => {
	it('adds pieces at the offset they start at, once', () => {
		const token = startUpload('uploader');
		expect(appendUpload(token, 0, Buffer.from('abc'))).toEqual({ status: 200, size: 3 });
		// The same piece again, as when a client retries.
		expect(appendUpload(token, 0, Buffer.from('abc'))).toEqual({ status: 409, size: 3 });
		expect(appendUpload(token, 3, Buffer.from('de'))).toEqual({ status: 200, size: 5 });
		expect(Buffer.from(takeUpload(token, 'uploader')!).toString()).toBe('abcde');
	});

	it('refuses pieces that are too big', () => {
		const token = startUpload('uploader');
		expect(appendUpload(token, 0, Buffer.alloc(BACKUP_CHUNK_BYTES + 1)).status).toBe(413);
	});

	it('only gives an upload to its user, once', () => {
		const token = startUpload('uploader');
		appendUpload(token, 0, Buffer.from('abc'));
		expect(takeUpload(token, 'someone else')).toBeNull();
		expect(takeUpload(token, 'uploader')).not.toBeNull();
		expect(takeUpload(token, 'uploader')).toBeNull();
		expect(appendUpload(token, 3, Buffer.from('d')).status).toBe(404);
	});

	it('keeps a few uploads per user, dropping the oldest', () => {
		const tokens = [1, 2, 3, 4].map(() => startUpload('busy'));
		expect(appendUpload(tokens[0], 0, Buffer.from('a')).status).toBe(404);
		for (const token of tokens.slice(1)) {
			expect(appendUpload(token, 0, Buffer.from('a')).status).toBe(200);
		}
	});
});

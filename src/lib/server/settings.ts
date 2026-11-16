import { and, eq, gte } from 'drizzle-orm';
import { db } from './db/index';
import { userSettings } from './db/schema';
import { changeStamp } from './notes';

/** Settings are a short encrypted JSON object, so anything much bigger is a mistake or abuse. */
const MAX_SETTINGS_BYTES = 64 * 1024;

type Executor = Pick<typeof db, 'select'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The settings as JSON, with the encrypted content base64 encoded. */
export interface SettingsJson {
	content: string;
	updatedAt: Date;
}

/**
 * The user's settings, or null if they have none. With `changedSince`, also
 * null if they haven't changed since that `changeStamp`.
 */
export function selectSettings(
	userId: string,
	changedSince: number | null = null,
	executor: Executor = db
): SettingsJson | null {
	const row = executor
		.select({ content: userSettings.content, updatedAt: userSettings.updatedAt })
		.from(userSettings)
		.where(
			and(
				eq(userSettings.userId, userId),
				changedSince === null ? undefined : gte(userSettings.changedAt, changedSince)
			)
		)
		.get();
	return row
		? { content: (row.content as Buffer).toString('base64'), updatedAt: row.updatedAt }
		: null;
}

export type SettingsWriteResult =
	| { status: 200; body: { updatedAt: Date } }
	| { status: 409; body: SettingsJson }
	| { status: 400 | 413; body: { message: string } };

/**
 * Replaces the user's settings, following last-write-wins on `updatedAt`, like
 * notes: an update that isn't newer than the stored settings is rejected with
 * 409, along with the stored settings. Run it in a transaction.
 */
export function writeSettings(
	tx: Transaction,
	userId: string,
	{ content, updatedAt }: Record<string, unknown>
): SettingsWriteResult {
	if (typeof content !== 'string') return { status: 400, body: { message: 'content is required' } };
	if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
		return { status: 400, body: { message: 'updatedAt is required' } };
	}
	const contentBuffer = Buffer.from(content, 'base64');
	if (contentBuffer.length > MAX_SETTINGS_BYTES) {
		return { status: 413, body: { message: 'Settings are too big' } };
	}
	const updatedAtDate = new Date(updatedAt);

	const stored = selectSettings(userId, null, tx);
	if (stored && updatedAtDate <= stored.updatedAt) return { status: 409, body: stored };

	const values = { content: contentBuffer, updatedAt: updatedAtDate, changedAt: changeStamp() };
	tx.insert(userSettings)
		.values({ userId, ...values })
		.onConflictDoUpdate({ target: userSettings.userId, set: values })
		.run();
	return { status: 200, body: { updatedAt: updatedAtDate } };
}

// Note history: earlier versions of a note, to go back to. Used by both the server and the app, so
// they keep the same versions: each is the note's encrypted content as it was stored, and is known
// by the note's id and the `updatedAt` of that content. See README.md.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A pause in editing this long starts a new session, and the note as it was before is kept. */
export const SESSION_GAP_MS = 10 * MINUTE;
/** While editing goes on without such a pause, a version is still kept this often. */
export const MAX_SESSION_MS = HOUR;

/** Every version is kept this long, then one a day, then one a week, then none. */
export const KEEP_ALL_MS = DAY;
export const KEEP_DAILY_MS = 30 * DAY;
export const KEEP_WEEKLY_MS = 90 * DAY;
/**
 * At most this much history per note, so a note with a pasted image, which is stored in its
 * text, doesn't fill up the storage. The oldest versions go first, but the newest is always kept.
 */
export const MAX_HISTORY_BYTES = 5 * 1024 * 1024;

/**
 * Whether to keep the note as it was before a change, as a version.
 *
 * @param previous When the note was last changed before this change, and when it was created.
 * @param changedAt When this change was made.
 * @param latestVersionAt The `updatedAt` of the newest version that is kept, if any.
 */
export function keepsPrevious(
	previous: { updatedAt: number; createdAt: number },
	changedAt: number,
	latestVersionAt: number | undefined
) {
	// Already kept.
	if (latestVersionAt !== undefined && latestVersionAt >= previous.updatedAt) return false;
	if (changedAt - previous.updatedAt >= SESSION_GAP_MS) return true;
	// A long session. A new note counts from when it was created, so its first few seconds aren't
	// kept as a version of their own.
	return previous.updatedAt - (latestVersionAt ?? previous.createdAt) >= MAX_SESSION_MS;
}

/** A version, as far as thinning out the history is concerned. */
export interface VersionInfo {
	updatedAt: number;
	/** The size of its encrypted content, in bytes. */
	size: number;
}

/**
 * Which versions of a note to delete: all are kept for a day, then the newest of each day for a
 * month, then the newest of each week until they're 90 days old, within `MAX_HISTORY_BYTES`.
 * Days and weeks are counted in UTC, so every device and the server thin out the same way.
 *
 * @returns The `updatedAt` of the versions to delete.
 */
export function versionsToDrop(versions: VersionInfo[], now: number): number[] {
	const newestFirst = [...versions].sort((a, b) => b.updatedAt - a.updatedAt);
	const drop: number[] = [];
	const seenPeriods = new Set<string>();
	let bytes = 0;
	for (const [index, version] of newestFirst.entries()) {
		const age = now - version.updatedAt;
		let keep: boolean;
		if (age < KEEP_ALL_MS) {
			keep = true;
		} else if (age < KEEP_WEEKLY_MS) {
			const period =
				age < KEEP_DAILY_MS
					? `d${Math.floor(version.updatedAt / DAY)}`
					: `w${Math.floor(version.updatedAt / (7 * DAY))}`;
			keep = !seenPeriods.has(period);
			seenPeriods.add(period);
		} else {
			keep = false;
		}
		if (keep && index > 0 && bytes + version.size > MAX_HISTORY_BYTES) keep = false;
		if (keep) {
			bytes += version.size;
		} else {
			drop.push(version.updatedAt);
		}
	}
	return drop;
}

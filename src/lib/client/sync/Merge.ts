import type { Note } from '../Database';

/** What to do with the local copy of a note, given the version on the server. */
export type MergeAction =
	/** Keep the local note; if it has unsynced changes, they will be pushed. */
	| 'keep-local'
	/** Replace (or create) the local note with the server version. */
	| 'take-server'
	/** The note was deleted on the server, so delete it locally too. */
	| 'delete-local';

/**
 * Decides how to merge a note from the server into the local database. Edits
 * follow last-write-wins on `updatedAt`, and deletions always win over edits.
 */
export function mergeServerNote(
	local: Pick<Note<Uint8Array>, 'updatedAt' | 'deletedAt'> | undefined,
	server: { updatedAt: Date; deletedAt: Date | null }
): MergeAction {
	if (server.deletedAt) {
		return local && !local.deletedAt ? 'delete-local' : 'keep-local';
	}
	if (!local) return 'take-server';
	// A local deletion that hasn't been pushed yet.
	if (local.deletedAt) return 'keep-local';
	return server.updatedAt > local.updatedAt ? 'take-server' : 'keep-local';
}

/** What to do with the user's local tags for a note, given the tags on the server. */
export type TagsMergeAction = 'keep-local' | 'take-server';

/**
 * Decides how to merge a user's tags from the server. Tags sync separately
 * from note content, with their own last-write-wins timestamp, so tagging a
 * note never conflicts with editing it.
 */
export function mergeServerTags(
	local: { tagsUpdatedAt?: Date } | undefined,
	server: { tagsUpdatedAt: Date | null }
): TagsMergeAction {
	if (!server.tagsUpdatedAt) return 'keep-local';
	if (!local?.tagsUpdatedAt) return 'take-server';
	return server.tagsUpdatedAt > local.tagsUpdatedAt ? 'take-server' : 'keep-local';
}

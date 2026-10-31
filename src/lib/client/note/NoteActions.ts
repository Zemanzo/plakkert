import { confirmation } from '../components/Confirmation.svelte';
import { toasts } from '../components/ToastStore.svelte';
import { loadTags, updateTags } from '../tags/TagsCRUD';
import {
	ARCHIVED_TAG,
	isTrashExpired,
	TRASHED_TAG,
	withoutTag,
	withTag,
	type NoteTags
} from '../tags/Tags';
import { deleteNote } from './NotesCRUD';
import type { NoteEntry } from './NoteStore.svelte';
import { leaveNote } from './Sharing';

// Archiving and trashing only change the user's own tags, so they work offline and don't affect
// anyone else the note is shared with. Each can be undone from the toast it shows.

/** Changes a tag and shows a toast that undoes the change. */
async function toggleTag(
	entry: NoteEntry,
	userId: string,
	tag: string,
	add: boolean,
	message: string
) {
	const { id } = entry.note;
	const apply = (adding: boolean) =>
		updateTags(id, userId, entry.noteKey, (tags: NoteTags) =>
			adding ? withTag(tags, tag) : withoutTag(tags, tag)
		);
	await apply(add);
	toasts.show(message, { label: 'Undo', run: () => apply(!add) });
}

export const archiveNote = (entry: NoteEntry, userId: string) =>
	toggleTag(entry, userId, ARCHIVED_TAG, true, 'Note archived');

export const unarchiveNote = (entry: NoteEntry, userId: string) =>
	toggleTag(entry, userId, ARCHIVED_TAG, false, 'Note unarchived');

export const trashNote = (entry: NoteEntry, userId: string) =>
	toggleTag(entry, userId, TRASHED_TAG, true, 'Note moved to the trash');

/** Takes a note out of the trash, back to where it was (e.g. still archived). */
export const restoreNote = (entry: NoteEntry, userId: string) =>
	toggleTag(entry, userId, TRASHED_TAG, false, 'Note restored');

/**
 * Deletes a note for good: for everyone if the user owns it, or otherwise
 * removes it from the user's notes on all their devices.
 */
async function deleteForever(entry: NoteEntry, userId: string) {
	if (entry.note.ownerId === userId) {
		await deleteNote(entry.note.id);
	} else {
		await leaveNote(entry.note.id, userId);
	}
}

/** Asks for confirmation, then deletes a note for good. */
export async function confirmDeleteForever(entry: NoteEntry, userId: string) {
	const isOwner = entry.note.ownerId === userId;
	const confirmed = await confirmation.ask(
		isOwner
			? {
					title: 'Delete forever?',
					message:
						'This note will be deleted on all your devices, and for everyone it is shared with. This can’t be undone.',
					confirmLabel: 'Delete forever',
					danger: true
				}
			: {
					title: 'Remove from your notes?',
					message: `This note will be removed from your notes on all your devices. ${entry.note.ownerUsername ?? 'Its owner'} still has it.`,
					confirmLabel: 'Remove',
					danger: true
				}
	);
	if (!confirmed) return false;
	await deleteForever(entry, userId);
	toasts.show(isOwner ? 'Note deleted forever' : 'Note removed from your notes');
	return true;
}

/** Asks for confirmation, then deletes all notes in the trash for good. */
export async function confirmEmptyTrash(entries: NoteEntry[], userId: string) {
	if (entries.length === 0) return;
	const count = entries.length === 1 ? 'the note' : `all ${entries.length} notes`;
	const confirmed = await confirmation.ask({
		title: 'Empty the trash?',
		message: `This deletes ${count} in the trash forever. This can’t be undone.`,
		confirmLabel: 'Empty trash',
		danger: true
	});
	if (!confirmed) return;

	const results = await Promise.allSettled(entries.map((entry) => deleteForever(entry, userId)));
	const failed = results.filter((result) => result.status === 'rejected');
	if (failed.length) {
		console.error('Failed to empty the trash', failed);
		// Removing notes that were shared with the user needs a connection.
		toasts.show(
			`${failed.length === 1 ? '1 note' : `${failed.length} notes`} could not be deleted. Try again when you’re online.`
		);
	} else {
		toasts.show('Trash emptied');
	}
}

/** Notes that are being purged, so a note isn't purged twice while the list catches up. */
const purging = new Set<string>();
/** The sync after which purging a note failed, so it is only retried after the next one. */
const purgeFailedAfter = new Map<string, number>();

/**
 * Deletes notes that have been in the trash for longer than
 * `TRASH_RETENTION_DAYS`. The server can't do this, because it can't read tags.
 *
 * Only call this once the notes are up to date with the server, so a note that
 * was restored on another device isn't deleted because this device hasn't
 * heard about it yet. Each note's tags are read again from IndexedDB right
 * before deleting it, as `entries` can lag behind it.
 *
 * @param lastPulledAt When the notes were last brought up to date with the server.
 */
export async function purgeExpiredTrash(entries: NoteEntry[], userId: string, lastPulledAt: Date) {
	const now = Date.now();
	const pull = lastPulledAt.getTime();
	for (const entry of entries) {
		const { id } = entry.note;
		if (!isTrashExpired(entry.tags, now) || purging.has(id)) continue;
		if (purgeFailedAfter.get(id) === pull) continue;

		purging.add(id);
		try {
			const tags = await loadTags(id, userId, entry.noteKey);
			if (isTrashExpired(tags, now)) {
				await deleteForever(entry, userId);
			}
			purgeFailedAfter.delete(id);
		} catch (error) {
			// E.g. offline, for notes shared with the user; tried again after the next sync.
			console.warn(`Could not purge note ${id} from the trash`, error);
			purgeFailedAfter.set(id, pull);
		} finally {
			purging.delete(id);
		}
	}
}

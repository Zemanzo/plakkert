import { confirmation } from '../components/Confirmation.svelte';
import { toasts } from '../components/ToastStore.svelte';
import { loadTags, updateTags, updateTagsOfNotes } from '../tags/TagsCRUD';
import {
	ARCHIVED_TAG,
	HIDDEN_TAG,
	isTrashExpired,
	POSITION_TAG,
	TRASHED_TAG,
	withoutTag,
	withTag,
	type NoteTags
} from '../tags/Tags';
import { deleteNotes, updateNotesColor } from './NotesCRUD';
import type { NoteEntry } from './NoteStore.svelte';
import { positionsAfterMove } from './Order';
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

const notesCount = (count: number) => (count === 1 ? '1 note' : `${count} notes`);

// Actions on several notes at once, e.g. the selected ones. They're written all at once, as every
// write updates the notes that are shown, which would take long for hundreds of notes one by one.

/** Changes the user's tags on several notes at once. */
export const updateTagsOfEntries = (
	entries: NoteEntry[],
	userId: string,
	update: (tags: NoteTags) => NoteTags
) =>
	updateTagsOfNotes(
		userId,
		new Map(entries.map((entry) => [entry.note.id, entry.noteKey])),
		update
	);

/** Adds or removes a tag on several notes, and shows a toast that undoes it. */
async function toggleTagOfMany(
	entries: NoteEntry[],
	userId: string,
	tag: string,
	add: boolean,
	done: string
) {
	const apply = (adding: boolean) =>
		updateTagsOfEntries(entries, userId, (tags) =>
			adding ? withTag(tags, tag) : withoutTag(tags, tag)
		);
	await apply(add);
	toasts.show(`${notesCount(entries.length)} ${done}`, { label: 'Undo', run: () => apply(!add) });
}

/** Archives or unarchives several notes at once. */
export const setArchived = (entries: NoteEntry[], userId: string, archived: boolean) =>
	toggleTagOfMany(entries, userId, ARCHIVED_TAG, archived, archived ? 'archived' : 'unarchived');

/** Moves several notes to the trash at once, or restores them. */
export const setTrashed = (entries: NoteEntry[], userId: string, trashed: boolean) =>
	toggleTagOfMany(
		entries,
		userId,
		TRASHED_TAG,
		trashed,
		trashed ? 'moved to the trash' : 'restored'
	);

/** Hides the text of several notes while they're closed, or shows it again. */
export const setHidden = (entries: NoteEntry[], userId: string, hidden: boolean) =>
	toggleTagOfMany(entries, userId, HIDDEN_TAG, hidden, hidden ? 'hidden' : 'shown');

/** Changes the colour of several notes at once. Notes the user may only view keep theirs. */
export async function setColor(entries: NoteEntry[], color: string) {
	const editable = entries.filter((entry) => entry.permission === 'edit');
	await updateNotesColor(editable, color);
	const viewOnly = entries.length - editable.length;
	if (viewOnly > 0) {
		toasts.show(
			viewOnly === 1
				? '1 note kept its colour, as you can only view it.'
				: `${viewOnly} notes kept their colour, as you can only view them.`
		);
	}
}

/**
 * Moves a note within a list of notes in the user's order, e.g. after it was
 * dragged elsewhere. Like tags, the order is the user's own.
 */
export async function moveNote(entries: NoteEntry[], from: number, to: number, userId: string) {
	const changes = positionsAfterMove(entries, from, to);
	await Promise.all(
		entries
			.filter((entry) => changes.has(entry.note.id))
			.map((entry) =>
				updateTags(entry.note.id, userId, entry.noteKey, (tags) => ({
					...tags,
					[POSITION_TAG]: changes.get(entry.note.id)!
				}))
			)
	);
}

/**
 * Deletes a note for good: for everyone if the user owns it, or otherwise
 * removes it from the user's notes on all their devices.
 */
async function deleteForever(entry: NoteEntry, userId: string) {
	if (entry.note.ownerId === userId) {
		await deleteNotes([entry.note.id]);
	} else {
		await leaveNote(entry.note.id, userId);
	}
}

/**
 * Deletes several notes for good, like `deleteForever`. Own notes are deleted
 * all at once; removing shared ones needs a request each.
 *
 * @returns How many notes couldn't be removed, e.g. shared notes while offline.
 */
async function deleteManyForever(entries: NoteEntry[], userId: string) {
	const owned = entries.filter((entry) => entry.note.ownerId === userId);
	const shared = entries.filter((entry) => entry.note.ownerId !== userId);
	if (owned.length > 0) await deleteNotes(owned.map((entry) => entry.note.id));
	const results = await Promise.allSettled(shared.map((entry) => leaveNote(entry.note.id, userId)));
	const failed = results.filter((result) => result.status === 'rejected');
	if (failed.length > 0) console.error('Failed to remove shared notes', failed);
	return failed.length;
}

/** Deletes notes for good, and tells how that went. */
async function deleteAndReport(entries: NoteEntry[], userId: string, done: string) {
	const failed = await deleteManyForever(entries, userId);
	// Removing notes that were shared with the user needs a connection.
	toasts.show(
		failed > 0 ? `${notesCount(failed)} could not be deleted. Try again when you’re online.` : done
	);
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
	await deleteAndReport(entries, userId, 'Trash emptied');
}

/**
 * Asks for confirmation, then deletes several notes for good.
 *
 * @returns Whether they were deleted.
 */
export async function confirmDeleteManyForever(entries: NoteEntry[], userId: string) {
	if (entries.length === 1) return confirmDeleteForever(entries[0], userId);
	const shared = entries.filter((entry) => entry.note.ownerId !== userId).length;
	const sharedMessage =
		shared === 0
			? ''
			: shared === 1
				? ' 1 note shared with you is only removed from your notes.'
				: ` ${shared} notes shared with you are only removed from your notes.`;
	const confirmed = await confirmation.ask({
		title: `Delete ${entries.length} notes forever?`,
		message: `They will be deleted on all your devices, and for everyone they are shared with.${sharedMessage} This can’t be undone.`,
		confirmLabel: 'Delete forever',
		danger: true
	});
	if (!confirmed) return false;
	await deleteAndReport(entries, userId, `${entries.length} notes deleted forever`);
	return true;
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

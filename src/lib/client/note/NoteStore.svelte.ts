import { liveQuery } from 'dexie';
import { db, type Note, type NotePermission } from '../Database';
import { decryptNoteData, decryptNoteKey, decryptTags } from '../serialization/Serialize';
import { buildSearchText, htmlToText, normalizeForSearch } from '../search/Search';
import { compareTags, isTrashed, userTags, type NoteTags } from '../tags/Tags';
import type { RuntimeUser } from '#lib/types.js';

/** A decrypted note, as shown in the app. */
export interface NoteEntry {
	note: Note;
	/** The decrypted key of the note. */
	noteKey: Uint8Array;
	permission: NotePermission;
	/** The user's own tags for the note, including whether it is archived or trashed. */
	tags: NoteTags;
	/** The note's text and tags, normalized for searching. */
	searchText: string;
}

export interface TagSummary {
	name: string;
	/** Number of notes with the tag, not counting notes in the trash. */
	count: number;
}

interface EncryptedRow {
	note: Note<Uint8Array>;
	encryptedKey: Uint8Array;
	encryptedTags: Uint8Array | undefined;
	permission: NotePermission;
}

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
	a === b || (!!a && !!b && a.length === b.length && a.every((byte, i) => byte === b[i]));

/**
 * The user's notes, decrypted. Updates whenever IndexedDB changes, e.g. after
 * every save and sync. All views (notes, tags, archive, trash and search)
 * filter this one list, so every note is only decrypted once.
 */
export class NoteStore {
	entries = $state.raw<NoteEntry[] | null>(null);
	failedCount = $state(0);
	loadError = $state<Error | null>(null);
	/** What is being searched for. Kept here, so it stays when switching between views. */
	searchQuery = $state('');

	/** The tags the user has, sorted by name. */
	tags: TagSummary[] = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this computation
		const counts = new Map<string, number>();
		for (const { tags } of this.entries ?? []) {
			const trashed = isTrashed(tags);
			for (const tag of userTags(tags)) {
				counts.set(tag, (counts.get(tag) ?? 0) + (trashed ? 0 : 1));
			}
		}
		return [...counts]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => compareTags(a.name, b.name));
	});

	#user: RuntimeUser;
	// Plain caches that are never rendered, so they don't need to be reactive. They make sure only
	// notes and tags that actually changed are decrypted again.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#noteKeys = new Map<string, Uint8Array>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#notes = new Map<string, { updatedAt: number; note: Note; normalizedText: string }>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#tags = new Map<string, { encrypted: Uint8Array | undefined; tags: NoteTags }>();

	constructor(user: RuntimeUser) {
		this.#user = user;
	}

	/** Starts following the database. Returns a function that stops it. */
	start() {
		let latestResult = 0;
		const userId = this.#user.id;
		const subscription = liveQuery(async () => {
			const noteKeys = await db.noteKeys.where({ userId }).toArray();
			const notes = await db.notes.bulkGet(noteKeys.map((noteKey) => noteKey.noteId));
			return noteKeys.flatMap((noteKey, i): EncryptedRow[] => {
				const note = notes[i];
				return note && !note.deletedAt
					? [
							{
								note,
								encryptedKey: noteKey.encryptedKey,
								encryptedTags: noteKey.tags,
								permission: noteKey.permission ?? 'edit'
							}
						]
					: [];
			});
		}).subscribe({
			next: async (rows) => {
				const result = ++latestResult;
				const decrypted = await Promise.all(rows.map((row) => this.#decrypt(row)));
				// A newer result may have arrived while decrypting.
				if (result !== latestResult) return;

				this.failedCount = decrypted.filter((entry) => entry === null).length;
				this.entries = decrypted.filter((entry) => entry !== null);
				this.loadError = null;
			},
			error: (error) => {
				console.error(error);
				this.loadError = error;
			}
		});
		return () => subscription.unsubscribe();
	}

	async #decrypt(row: EncryptedRow): Promise<NoteEntry | null> {
		const { id } = row.note;
		let noteKey: Uint8Array;
		let note: Note;
		let normalizedText: string;
		try {
			noteKey = this.#noteKeys.get(id) ?? (await this.#decryptNoteKey(row));
			this.#noteKeys.set(id, noteKey);

			const updatedAt = row.note.updatedAt.getTime();
			const cached = this.#notes.get(id);
			if (cached?.updatedAt === updatedAt) {
				({ note, normalizedText } = cached);
			} else {
				note = { ...row.note, data: await decryptNoteData(row.note.data, noteKey) };
				normalizedText = normalizeForSearch(htmlToText(note.data.content));
				this.#notes.set(id, { updatedAt, note, normalizedText });
			}
		} catch (error) {
			console.error(`Failed to decrypt note ${id}`, error);
			return null;
		}

		// A note whose tags can't be decrypted is still shown, just without its tags.
		let tags: NoteTags = {};
		const cachedTags = this.#tags.get(id);
		if (cachedTags && sameBytes(cachedTags.encrypted, row.encryptedTags)) {
			tags = cachedTags.tags;
		} else {
			try {
				tags = row.encryptedTags ? await decryptTags(row.encryptedTags, noteKey) : {};
			} catch (error) {
				console.error(`Failed to decrypt the tags of note ${id}`, error);
			}
			this.#tags.set(id, { encrypted: row.encryptedTags, tags });
		}

		return {
			note,
			noteKey,
			permission: row.permission,
			tags,
			searchText: buildSearchText(normalizedText, userTags(tags))
		};
	}

	#decryptNoteKey(row: EncryptedRow) {
		return decryptNoteKey(
			row.encryptedKey,
			this.#user.publicKeyUint8,
			this.#user.decodedPrivateKey
		);
	}
}

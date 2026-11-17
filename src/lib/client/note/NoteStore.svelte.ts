import { liveQuery } from 'dexie';
import { db, type Note, type NotePermission } from '../Database';
import { decryptNoteData, decryptNoteKey, decryptTags } from '../serialization/Serialize';
import { buildSearchText, htmlToText, normalizeForSearch } from '../search/Search';
import {
	decryptSyncedSettings,
	defaultSyncedSettings,
	type SyncedSettings
} from '../settings/SyncedSettings';
import {
	hiddenMessage,
	isTrashed,
	tagOrderComparator,
	userTags,
	type NoteTags
} from '../tags/Tags';
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
	/**
	 * Whether notes are being selected in the view. On narrow screens, the navigation makes way
	 * for the selection meanwhile, as going elsewhere would end it anyway.
	 */
	selecting = $state(false);

	/** The user's settings that sync across devices. */
	settings = $state.raw<SyncedSettings>(defaultSyncedSettings);
	/** Compares tag names, to sort them in the user's own order. */
	compareTags = $derived(tagOrderComparator(this.settings.tagOrder));

	/** The tags the user has, in their own order. */
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
			.sort((a, b) => this.compareTags(a.name, b.name));
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
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#entries = new Map<string, NoteEntry>();

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
		const settings = this.#followSettings();
		return () => {
			subscription.unsubscribe();
			settings.unsubscribe();
		};
	}

	#followSettings() {
		let latestResult = 0;
		const user = this.#user;
		return liveQuery(() => db.syncedSettings.get(user.id)).subscribe({
			next: async (row) => {
				const result = ++latestResult;
				try {
					const settings = await decryptSyncedSettings(row?.content, user);
					if (result === latestResult) this.settings = settings;
				} catch (error) {
					// The defaults are used instead, until they're saved again.
					console.error('Failed to decrypt the settings', error);
				}
			},
			error: (error) => console.error(error)
		});
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

		// The same entry as before if nothing changed, so only notes that did change are updated in
		// the page. Otherwise, every save would update every note that is shown.
		const previous = this.#entries.get(id);
		if (
			previous?.note === note &&
			previous.tags === tags &&
			previous.noteKey === noteKey &&
			previous.permission === row.permission
		) {
			return previous;
		}
		const entry: NoteEntry = {
			note,
			noteKey,
			permission: row.permission,
			tags,
			// A hidden note can also be found by the message shown in its place.
			searchText: buildSearchText(
				[normalizedText, normalizeForSearch(hiddenMessage(tags))].join('\n'),
				userTags(tags)
			)
		};
		this.#entries.set(id, entry);
		return entry;
	}

	#decryptNoteKey(row: EncryptedRow) {
		return decryptNoteKey(
			row.encryptedKey,
			this.#user.publicKeyUint8,
			this.#user.decodedPrivateKey
		);
	}
}

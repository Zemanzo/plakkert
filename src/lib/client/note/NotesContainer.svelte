<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';
	import { liveQuery } from 'dexie';
	import Note from './Note.svelte';
	import { db, type Note as NoteType } from '../Database';
	import { decryptNoteData, decryptNoteKey } from '../serialization/Serialize';
	import type { RuntimeUser } from '#lib/types.js';
	import Button from '../components/Button.svelte';
	import { createNote } from './NotesCRUD';

	interface DecryptedNote {
		note: NoteType;
		noteKey: Uint8Array;
	}

	const user = getContext<() => RuntimeUser>('user')();
	let notes = $state<DecryptedNote[] | null>(null);
	let failedCount = $state(0);
	let loadError = $state<Error | null>(null);
	let focusedNoteId = $state<string | null>(null);
	let hasFocusedNote = $derived(focusedNoteId !== null);

	// The list updates whenever IndexedDB changes, e.g. after every save and sync. Cache decrypted
	// keys and notes, so only notes that actually changed are decrypted again.
	// These are plain caches that are never rendered, so they don't need to be reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const noteKeyCache = new Map<string, Uint8Array>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const noteCache = new Map<string, { updatedAt: number; note: NoteType }>();

	async function decrypt(
		encryptedNote: NoteType<Uint8Array>,
		encryptedKey: Uint8Array
	): Promise<DecryptedNote | null> {
		try {
			let noteKey = noteKeyCache.get(encryptedNote.id);
			if (!noteKey) {
				noteKey = await decryptNoteKey(encryptedKey, user.publicKeyUint8, user.decodedPrivateKey);
				noteKeyCache.set(encryptedNote.id, noteKey);
			}

			const updatedAt = encryptedNote.updatedAt.getTime();
			const cached = noteCache.get(encryptedNote.id);
			if (cached?.updatedAt === updatedAt) {
				return { note: cached.note, noteKey };
			}

			const note = {
				...encryptedNote,
				data: await decryptNoteData(encryptedNote.data, noteKey)
			} satisfies NoteType;
			noteCache.set(encryptedNote.id, { updatedAt, note });
			return { note, noteKey };
		} catch (error) {
			console.error(`Failed to decrypt note ${encryptedNote.id}`, error);
			return null;
		}
	}

	function unfocus(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			focusedNoteId = null;
		}
	}

	async function addNote() {
		// The note shows up through the live query, and focuses itself once it does.
		focusedNoteId = await createNote(user);
	}

	function onDeleteNote() {
		focusedNoteId = null;
	}

	onMount(() => {
		let latestResult = 0;
		const subscription = liveQuery(async () => {
			const noteKeys = await db.noteKeys.where({ userId: user.id }).toArray();
			const encryptedNotes = await db.notes.bulkGet(noteKeys.map((noteKey) => noteKey.noteId));
			return noteKeys.flatMap((noteKey, i) => {
				const note = encryptedNotes[i];
				return note && !note.deletedAt ? [{ note, encryptedKey: noteKey.encryptedKey }] : [];
			});
		}).subscribe({
			next: async (rows) => {
				const result = ++latestResult;
				const decrypted = await Promise.all(
					rows.map(({ note, encryptedKey }) => decrypt(note, encryptedKey))
				);
				// A newer result may have arrived while decrypting.
				if (result !== latestResult) return;

				failedCount = decrypted.filter((entry) => entry === null).length;
				notes = decrypted
					.filter((entry) => entry !== null)
					.sort((a, b) => b.note.createdAt.getTime() - a.note.createdAt.getTime());
			},
			error: (error) => {
				console.error(error);
				loadError = error;
			}
		});

		window.addEventListener('keydown', unfocus);

		return () => {
			subscription.unsubscribe();
			window.removeEventListener('keydown', unfocus);
		};
	});
</script>

<div class="controls">
	<Button onclick={addNote}>+ New note</Button>
</div>
{#if hasFocusedNote}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-background"
		transition:fade={{ duration: 200 }}
		onclick={() => (focusedNoteId = null)}
	></div>
{/if}
<div class="scroll-container">
	<div class="notes-container" class:hasFocusedNote>
		{#if loadError}
			<div>Error loading notes: {loadError.message}</div>
		{:else if notes === null}
			<p>Loading...</p>
		{:else}
			{#if notes.length === 0 && failedCount === 0}
				<p>No notes yet. Click "New note" to create your first note!</p>
			{/if}
			{#each notes as { note, noteKey } (note.id)}
				<Note {note} {noteKey} bind:focusedNoteId onDelete={onDeleteNote} />
			{/each}
			{#if failedCount > 0}
				<div>
					{failedCount === 1 ? '1 note' : `${failedCount} notes`} could not be decrypted.
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.controls {
		display: flex;
		padding: var(--spacing-lg);
		gap: var(--spacing-md);
		justify-content: center;
	}

	.scroll-container {
		overflow: auto;
		height: 100%;
		flex: 1;
	}

	.notes-container {
		flex: 1;

		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		grid-auto-rows: minmax(40px, auto);
		align-items: start;

		gap: 8px;
		align-content: start;
		justify-content: center;
		max-width: 100%;

		padding: var(--spacing-lg);

		p {
			font-family: var(--font-family-display);
			font-size: 1.3rem;
			text-align: center;
			grid-column: 1 / -1;
		}
	}

	.modal-background {
		background: rgba(0, 0, 0, 0.5);
		position: absolute;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
	}
</style>

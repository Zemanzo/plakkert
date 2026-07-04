<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';
	import Note from './Note.svelte';
	import { db, type NoteKey } from './Database';
	import { decryptNote } from './serialization/Serialize';
	import type { RuntimeUser } from '$lib/types';
	import Button from './components/Button.svelte';
	import { createNote } from './NotesCRUD';

	const user = getContext<() => RuntimeUser>('user')();
	let focusedNoteId = $state<string | null>(null);
	let hasFocusedNote = $derived(focusedNoteId !== null);

	const getNoteContent = async (noteKey: NoteKey) => {
		const encryptedNote = await db.notes.get(noteKey.noteId);
		if (!encryptedNote) {
			console.warn(`Note with ID ${noteKey.noteId} not found for user ${user.id}`);
			return null;
		}
		const decryptedContent = await decryptNote(
			encryptedNote.content,
			noteKey.encryptedKey,
			user.decodedPrivateKey!,
			user.publicKey
		);

		return { ...encryptedNote, content: decryptedContent };
	};

	const initialNotes = (async () => {
		const noteKeys = await db.noteKeys.where({ userId: user.id }).toArray();
		return noteKeys.map((noteKey) => [noteKey.noteId, getNoteContent(noteKey)] as const);
	})();

	function unfocus(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			focusedNoteId = null;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', unfocus);

		return () => {
			window.removeEventListener('keydown', unfocus);
		};
	});
</script>

<div class="controls">
	<Button onclick={() => createNote(user)}>+ New note</Button>
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
		{#await initialNotes}
			<p>Loading...</p>
		{:then encryptedNotes}
			{#if encryptedNotes.length === 0}
				<p>No notes yet. Click "Add note" to create your first note!</p>
			{/if}
			{#each encryptedNotes as [noteId, decryptedNotePromise] (noteId)}
				{#await decryptedNotePromise}
					<div>Loading note...</div>
				{:then note}
					<Note id={noteId} content={note?.content ?? ''} bind:focusedNoteId />
				{/await}
			{/each}
		{:catch error}
			{console.error(error)}
			<div>Error loading notes: {error.message}</div>
		{/await}
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

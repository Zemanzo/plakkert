<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';
	import Note from './Note.svelte';
	import { liveQuery } from 'dexie';
	import { db, type Note as NoteType } from './Database';

	const user = getContext<{ id: string }>('user');
	let focusedNoteId = $state<string | null>(null);
	let hasFocusedNote = $derived(focusedNoteId !== null);

	let notes = liveQuery(() => db.notes.toArray());

	const addNote = async () => {
		await db.notes.add({
			id: crypto.randomUUID(),
			ownerId: user.id,
			content: '',
			meta: {
				color: 'yellow'
			},
			createdAt: new Date(),
			updatedAt: new Date()
		} satisfies NoteType);
	};

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

<div>
	<button onclick={addNote}> Add note </button>
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
		{#each $notes as note (note.id)}
			<Note id={note.id} bind:focusedNoteId />
		{/each}
	</div>
</div>

<style>
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

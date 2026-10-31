<script lang="ts">
	import Note from './Note.svelte';
	import type { NoteEntry } from './NoteStore.svelte';

	let {
		entries,
		focusedNoteId = $bindable()
	}: {
		entries: NoteEntry[];
		focusedNoteId: string | null;
	} = $props();
</script>

<div class="notesGrid">
	{#each entries as entry (entry.note.id)}
		<Note {entry} bind:focusedNoteId />
	{/each}
</div>

<style>
	.notesGrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(350px, 100%), 1fr));
		grid-auto-rows: minmax(40px, auto);
		align-items: start;
		gap: 8px;
		align-content: start;
		justify-content: center;
		max-width: 100%;
	}
</style>

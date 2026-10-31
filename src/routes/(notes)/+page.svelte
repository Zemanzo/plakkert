<script lang="ts">
	import { page } from '$app/state';
	import NotesView from '#lib/client/note/NotesView.svelte';

	// Notes with a tag are shown at /?tag=..., so this page also works offline for any tag.
	const tag = $derived(page.url.searchParams.get('tag'));
</script>

<NotesView view={tag ? { kind: 'tag', tag } : { kind: 'notes' }} />

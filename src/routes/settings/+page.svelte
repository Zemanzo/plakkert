<script lang="ts">
	import Settings from '$lib/client/settings/Settings.svelte';
</script>

<main>
	<Settings />
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;

		padding: var(--spacing-lg);
	}
</style>

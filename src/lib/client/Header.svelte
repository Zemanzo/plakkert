<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { sessionRemovePrivateKey } from '$lib/client/cryptography/PrivateKey';
	import Button from './components/Button.svelte';

	let { user }: { user?: { id: string } } = $props();
</script>

<svelte:head>
	<title>Plakkert</title>
</svelte:head>
<header>
	<div id="brand">
		<img src="/icon.svg" alt="Logo" width="24" height="24" />
		<h1>Plakkert</h1>
	</div>
	{#if user}
		<p>Your user ID is {user.id}.</p>
		<form
			method="post"
			action="/?/signOut"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'redirect') {
						sessionRemovePrivateKey();
					}
					await applyAction(result);
				};
			}}
		>
			<Button class="sm" --bg="var(--color-red)" type="submit">Sign out</Button>
		</form>
	{/if}
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-background-header);
		padding: var(--spacing-md) var(--spacing-lg);

		#brand {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);

			h1 {
				font-family: var(--font-family-display);
				font-size: 1.5rem;
				line-height: 1;
				margin: 0;
				margin-block: 0;
			}
		}

		p {
			margin: 0;
			margin-block: 0;
		}
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { logout } from '#lib/client/auth/Account.js';
	import { localUser } from '#lib/client/User.svelte.js';
	import Button from './components/Button.svelte';

	const user = $derived(localUser.data);

	async function signOut() {
		await logout();
		await goto(resolve('/login'));
	}
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
		<nav>
			<a href={resolve('/')} aria-current={page.url.pathname === '/'}>Notes</a>

			<a href={resolve('settings')} aria-current={page.url.pathname === '/settings'}>Settings</a>
		</nav>
		<!-- <p>Your user ID is {user.id}.</p> -->
		<Button class="sm" --bg="var(--color-red)" onclick={signOut}>Sign out</Button>
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
			margin-right: var(--spacing-3xl);

			h1 {
				font-family: var(--font-family-display);
				font-size: 1.5rem;
				line-height: 1;
				margin: 0;
				margin-block: 0;
			}
		}

		nav {
			display: flex;
			align-items: stretch;
			font-family: var(--font-family-display);
			flex: 1;
			gap: var(--spacing-md);
			font-size: 1.05rem;

			a {
				display: block;
				text-decoration: none;
				color: var(--color-text);
				padding: var(--spacing-sm) var(--spacing-md);
				border-radius: var(--radius-lg);
				opacity: 0.7;
				transition: opacity var(--transition-duration) ease;

				&[aria-current='true'] {
					opacity: 1;
				}

				&:not([aria-current='true']):hover {
					background-color: #fff1;
					opacity: 1;
				}
			}
		}

		p {
			margin: 0;
			margin-block: 0;
		}
	}
</style>

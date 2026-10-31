<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { logout } from '#lib/client/auth/Account.js';
	import { localUser } from '#lib/client/User.svelte.js';
	import LogOutIcon from '@iconify-svelte/lucide/log-out';

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
			<a href={resolve('/(notes)')} aria-current={page.url.pathname !== '/settings'}>Notes</a>

			<a href={resolve('/settings')} aria-current={page.url.pathname === '/settings'}>Settings</a>
		</nav>
		<!-- Quiet rather than red: signing out loses nothing, and red is kept for deleting notes. -->
		<button class="signOut" onclick={signOut}>
			<LogOutIcon width="18px" aria-hidden="true" />Sign out
		</button>
	{/if}
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
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

		.signOut {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
			padding: var(--spacing-sm) var(--spacing-md);
			border-radius: var(--radius-lg);
			font-family: var(--font-family-display);
			font-size: 1.05rem;
			white-space: nowrap;
			color: var(--color-text-primary);
			opacity: 0.7;
			cursor: pointer;
			transition:
				opacity var(--transition-duration) ease,
				color var(--transition-duration) ease;

			&:hover {
				opacity: 1;
				color: var(--color-red);
				background-color: #8882;
			}
		}
	}

	@media (max-width: 600px) {
		header {
			padding-inline: var(--spacing-md);

			#brand {
				margin-right: 0;
			}

			nav {
				gap: 0;
			}
		}
	}

	/* Too narrow for the name next to the links; the logo is enough. */
	@media (max-width: 420px) {
		header #brand h1 {
			display: none;
		}
	}
</style>

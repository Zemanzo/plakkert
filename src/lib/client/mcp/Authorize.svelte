<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { DEFAULT_MCP_PERMISSIONS, type McpPermissions, type McpTagFilter } from '#lib/mcp.js';
	import { getUnlockedSession } from '../auth/Session';
	import Button from '../components/Button.svelte';
	import { decodeKey } from '../cryptography/PrivateKey';
	import { db } from '../Database';
	import { loadTagNames } from '../tags/TagsCRUD';
	import { clientRedirect, wrapKeyForGrant } from './Grant';
	import { sealTagFilter } from './Permissions';
	import PermissionsEditor from './PermissionsEditor.svelte';

	// Where an MCP client sends the user to approve it (OAuth's authorization endpoint). The
	// request is checked by the server; this page shows it, lets the user choose what the client
	// may do, and on approval encrypts the user's private key for the client. See
	// `src/lib/server/mcp/oauth.ts`.

	type Request = {
		clientName: string;
		redirectUri: string;
		state: string | null;
		issuer: string;
		mcpEnabled: boolean;
	};

	let request = $state<Request | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let permissions = $state<McpPermissions>({ ...DEFAULT_MCP_PERMISSIONS });
	let filterTags = $state<McpTagFilter>([]);
	let availableTags = $state<string[]>([]);

	const query = location.search.slice(1);

	/** The signed-in user's keys, from this device. */
	async function userKeys() {
		const session = getUnlockedSession();
		const user = session && (await db.users.get(session.userId));
		return user && session
			? { id: user.id, publicKey: decodeKey(user.publicKey), privateKey: session.privateKey }
			: null;
	}

	onMount(async () => {
		const keys = await userKeys();
		if (keys) {
			const names = await loadTagNames({
				id: keys.id,
				publicKeyUint8: keys.publicKey,
				decodedPrivateKey: keys.privateKey
			});
			availableTags = [...names];
		}
	});

	onMount(async () => {
		try {
			const response = await fetch(`/api/oauth/authorize?${query}`);
			if (response.status === 404) {
				problem = 'This server doesn’t offer MCP.';
				return;
			}
			if (response.status === 401) {
				problem =
					'Your session has expired. Log out, log in again, and then connect the app again.';
				return;
			}
			const result = await response.json();
			if (result.ok) {
				request = result;
			} else if (result.redirect) {
				// Something the client got wrong, which it should hear about itself.
				location.replace(
					clientRedirect(result.redirectUri, {
						error: result.error,
						error_description: result.description,
						state: result.state
					})
				);
			} else {
				problem = result.description;
			}
		} catch (error) {
			console.error(error);
			problem = 'The request couldn’t be checked. Are you online?';
		}
	});

	/** Where the client is, as far as it can be told: its redirect URI's host, or its own scheme. */
	const destination = $derived.by(() => {
		if (!request) return '';
		const url = new URL(request.redirectUri);
		return url.host ? `${url.protocol}//${url.host}` : url.protocol;
	});

	async function turnOn() {
		busy = true;
		try {
			const response = await fetch('/api/mcp/access', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: true })
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			if (request) request.mcpEnabled = true;
		} catch (error) {
			console.error(error);
			problem = 'MCP access couldn’t be turned on.';
		} finally {
			busy = false;
		}
	}

	const allowsAnything = $derived(
		permissions.read ||
			permissions.create ||
			permissions.edit ||
			permissions.delete ||
			permissions.organize ||
			permissions.share ||
			permissions.backup
	);

	async function allow() {
		const keys = await userKeys();
		if (!request || !keys) return;
		busy = true;
		try {
			const { wrappedKey, secret, secretHash } = await wrapKeyForGrant(keys.privateKey);
			const response = await fetch('/api/oauth/authorize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query,
					wrappedKey,
					secretHash,
					permissions,
					tagFilter: permissions.read ? await sealTagFilter(filterTags, keys.publicKey) : null
				})
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok || !result.ok) {
				throw new Error(result.description ?? `HTTP ${response.status}`);
			}
			location.replace(
				clientRedirect(request.redirectUri, {
					code: `${result.codeId}.${secret}`,
					state: request.state,
					iss: request.issuer
				})
			);
		} catch (error) {
			console.error(error);
			problem = error instanceof Error ? error.message : 'The app couldn’t be connected.';
			busy = false;
		}
	}

	function deny() {
		if (!request) return;
		location.replace(
			clientRedirect(request.redirectUri, {
				error: 'access_denied',
				state: request.state,
				iss: request.issuer
			})
		);
	}
</script>

<section class="authorize">
	{#if problem}
		<h1>Can’t connect this app</h1>
		<p class="problem">{problem}</p>
		<a href={resolve('/(notes)')}>Back to your notes</a>
	{:else if !request}
		<p>Checking the request…</p>
	{:else}
		<h1>Let “{request.clientName}” use your notes?</h1>
		<p class="unverified">
			The app chose this name itself. Only continue if you just connected it, from an app you trust.
		</p>
		<div class="choose">
			<h2>What it may do</h2>
			<PermissionsEditor
				id="authorize"
				bind:permissions
				bind:tags={filterTags}
				{availableTags}
				disabled={busy}
			/>
		</div>
		<ul>
			<li>
				Reading includes the archive, the trash and notes shared with you, as far as the choices
				above allow.
			</li>
			<li>
				Your notes are end-to-end encrypted, so this server decrypts and encrypts them for the app
				while it uses them. Nothing is decrypted otherwise.
			</li>
			<li>You’ll go back to <strong>{destination}</strong>.</li>
			<li>You can change this, or disconnect it, at any time in the settings.</li>
		</ul>
		{#if !request.mcpEnabled}
			<p class="off">MCP access is turned off for your account. Turn it on to connect apps.</p>
			<div class="actions">
				<Button disabled={busy} onclick={turnOn}>Turn on MCP access</Button>
				<Button
					--bg="var(--color-input-background)"
					--text="var(--color-text-primary)"
					disabled={busy}
					onclick={deny}>Cancel</Button
				>
			</div>
		{:else}
			<div class="actions">
				<Button disabled={busy || !allowsAnything} onclick={allow}>Allow</Button>
				<Button
					--bg="var(--color-input-background)"
					--text="var(--color-text-primary)"
					disabled={busy}
					onclick={deny}>Deny</Button
				>
			</div>
		{/if}
	{/if}
</section>

<style>
	.authorize {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		max-width: min(60ch, 100%);
		margin: var(--spacing-xxl) auto;
		padding: var(--spacing-lg);

		h1 {
			font-family: var(--font-family-display);
			font-size: 1.5rem;
			overflow-wrap: anywhere;
		}

		ul {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-sm);
			padding-left: var(--spacing-lg);
			list-style: disc;
		}

		.choose {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-sm);
			padding: var(--spacing-md);
			border-radius: var(--radius-md);
			background-color: #fff1;

			h2 {
				font-family: var(--font-family-display);
				font-size: 1.2rem;
			}
		}

		.unverified {
			font-size: 0.85rem;
			color: var(--color-text-muted);
		}

		.problem,
		.off {
			font-weight: 500;
		}

		a {
			text-decoration: underline;
		}

		.actions {
			display: flex;
			gap: var(--spacing-md);
		}
	}
</style>

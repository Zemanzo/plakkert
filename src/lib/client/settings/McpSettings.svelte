<script lang="ts">
	import { onMount } from 'svelte';
	import { MCP_PATH, type McpPermissions, type McpTagFilter } from '#lib/mcp.js';
	import { getUnlockedSession } from '../auth/Session';
	import Button from '../components/Button.svelte';
	import { confirmation } from '../components/Confirmation.svelte';
	import { decodeKey } from '../cryptography/PrivateKey';
	import { openTagFilter, saveClientAccess, type McpClient } from '../mcp/Permissions';
	import PermissionsEditor from '../mcp/PermissionsEditor.svelte';
	import { loadTagNames } from '../tags/TagsCRUD';
	import { localUser } from '../User.svelte';

	// Whether MCP clients, such as AI assistants, may use the user's notes, which ones do, and
	// what each may do. Kept on the server, so it needs a connection. See src/lib/server/mcp/.

	let {
		onAvailable
	}: {
		/** Tells whether the server allows MCP at all (its MCP environment variable). */
		onAvailable: (available: boolean) => void;
	} = $props();

	type Client = McpClient;

	let enabled = $state<boolean | null>(null);
	let clients = $state<Client[]>([]);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let copied = $state(false);

	/** The app whose permissions are being changed, with the changes so far. */
	let editing = $state<{
		id: string;
		permissions: McpPermissions;
		tags: McpTagFilter;
		/** The filter couldn't be decrypted, so saving starts over without one. */
		unreadable: boolean;
	} | null>(null);
	let availableTags = $state<string[]>([]);

	const keys = () => {
		const session = getUnlockedSession();
		const user = localUser.data;
		return session && user
			? { id: user.id, publicKey: decodeKey(user.publicKey), privateKey: session.privateKey }
			: null;
	};

	/** What an app may do, in a few words. */
	function describe({ permissions: p }: Client) {
		const parts = [];
		if (p.read) parts.push(p.readHidden ? 'Read, also hidden notes' : 'Read');
		const writes = [
			p.create && 'create',
			p.edit && 'edit',
			p.delete && 'delete',
			p.organize && 'organise',
			p.share && 'share'
		].filter(Boolean);
		if (writes.length > 0) parts.push(`${parts.length > 0 ? 'w' : 'W'}rite: ${writes.join(', ')}`);
		return parts.length > 0 ? parts.join(' · ') : 'Nothing';
	}

	async function edit(client: Client) {
		const userKeys = keys();
		if (!userKeys) return;
		const tags = await openTagFilter(client.tagFilter, userKeys);
		editing = {
			id: client.id,
			permissions: { ...client.permissions },
			tags: tags ?? [],
			unreadable: tags === null
		};
		const names = await loadTagNames({
			id: userKeys.id,
			publicKeyUint8: userKeys.publicKey,
			decodedPrivateKey: userKeys.privateKey
		});
		availableTags = [...names];
	}

	async function saveEditing() {
		const userKeys = keys();
		if (!editing || !userKeys) return;
		const { id, permissions, tags, unreadable } = $state.snapshot(editing);
		// The filter that couldn't be read might have kept notes from the app; saving without one
		// would let it see them all.
		if (unreadable && permissions.read && tags.length === 0) {
			const confirmed = await confirmation.ask({
				title: 'Let the app see all your notes?',
				message:
					'Its tag filter couldn’t be decrypted, so it can’t be told which notes it kept from the app. Without tags chosen, the app can see all your notes' +
					(permissions.readHidden ? ', also hidden ones.' : ', except hidden ones.'),
				confirmLabel: 'Save without a filter',
				danger: true
			});
			if (!confirmed) return;
		}
		busy = true;
		problem = null;
		try {
			await saveClientAccess(id, permissions, permissions.read ? tags : [], userKeys.publicKey);
			await request('GET');
			editing = null;
		} catch (error) {
			console.warn('Could not change the app’s permissions', error);
			problem = 'The permissions couldn’t be changed. Are you online?';
		} finally {
			busy = false;
		}
	}

	const mcpUrl = `${location.origin}${MCP_PATH}`;
	const formatDate = (date: string) =>
		new Date(date).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});

	async function request(method: 'GET' | 'PUT', body?: unknown) {
		const response = await fetch('/api/mcp/access', {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});
		if (response.status === 404) {
			onAvailable(false);
			return;
		}
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		onAvailable(true);
		({ enabled, clients } = await response.json());
	}

	onMount(async () => {
		try {
			await request('GET');
		} catch (error) {
			console.warn('Could not load MCP access', error);
			problem = 'This needs a connection to the server.';
		}
	});

	async function setEnabled(on: boolean) {
		if (!on && clients.length > 0) {
			const confirmed = await confirmation.ask({
				title: 'Turn off MCP access?',
				message:
					clients.length === 1
						? `“${clients[0].clientName}” will be disconnected, and has to be connected again to read your notes.`
						: `All ${clients.length} connected apps will be disconnected, and have to be connected again to read your notes.`,
				confirmLabel: 'Turn off',
				danger: true
			});
			if (!confirmed) return;
		}
		busy = true;
		problem = null;
		try {
			await request('PUT', { enabled: on });
		} catch (error) {
			console.warn('Could not change MCP access', error);
			problem = 'MCP access couldn’t be changed. Are you online?';
		} finally {
			busy = false;
		}
	}

	async function disconnect(client: Client) {
		if (editing?.id === client.id) editing = null;
		busy = true;
		problem = null;
		try {
			const response = await fetch(`/api/mcp/clients/${encodeURIComponent(client.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
			clients = clients.filter((c) => c.id !== client.id);
		} catch (error) {
			console.warn('Could not disconnect', error);
			problem = 'The app couldn’t be disconnected. Are you online?';
		} finally {
			busy = false;
		}
	}

	async function copyUrl() {
		await navigator.clipboard.writeText(mcpUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="preferenceItem">
	<div>
		<label for="mcp-enabled">Let MCP clients use your notes</label>
		<p>
			Apps that speak MCP, such as AI assistants, can then use your notes once you connect them, as
			far as you allow each one: reading, and changing them if you like. As your notes are
			end-to-end encrypted, this server decrypts them for a connected app while it uses them, with a
			key that only that app has.
		</p>
	</div>
	<input
		id="mcp-enabled"
		class="themedCheckbox"
		type="checkbox"
		checked={enabled ?? false}
		disabled={enabled === null || busy}
		onchange={(event) => setEnabled(event.currentTarget.checked)}
	/>
</div>

{#if problem}
	<div class="preferenceItem">
		<p class="problem">{problem}</p>
	</div>
{/if}

{#if enabled}
	<div class="preferenceItem mcpUrl">
		<div>
			<span class="label">Server address</span>
			<p>Add this as a custom connector or MCP server in your app, and sign in when it asks.</p>
			<code>{mcpUrl}</code>
		</div>
		<Button class="sm" onclick={copyUrl}>{copied ? 'Copied' : 'Copy'}</Button>
	</div>
	<div class="preferenceItem clients">
		<div>
			<span class="label">Connected apps</span>
			{#if clients.length === 0}
				<p>None yet.</p>
			{:else}
				<ul>
					{#each clients as client (client.id)}
						<li aria-label={client.clientName}>
							<div class="client">
								<div>
									<span class="name">{client.clientName}</span>
									<p>
										Connected {formatDate(client.createdAt)} · {client.lastUsedAt
											? `last used ${formatDate(client.lastUsedAt)}`
											: 'not used yet'}
									</p>
									<p class="access">{describe(client)}</p>
								</div>
								<div class="buttons">
									{#if editing?.id !== client.id}
										<Button
											class="sm"
											--bg="var(--color-input-background)"
											--text="var(--color-text-primary)"
											disabled={busy}
											onclick={() => edit(client)}>Permissions</Button
										>
									{/if}
									<Button
										class="sm"
										--bg="var(--color-red)"
										--text="var(--color-text-primary)"
										disabled={busy}
										onclick={() => disconnect(client)}>Disconnect</Button
									>
								</div>
							</div>
							{#if editing?.id === client.id}
								<div class="editing">
									{#if editing.unreadable}
										<p class="problem">
											Its tag filter couldn’t be decrypted, so it can’t read any notes now. Choose
											its tags again: saving replaces the filter.
										</p>
									{/if}
									<PermissionsEditor
										id="client-{client.id}"
										bind:permissions={editing.permissions}
										bind:tags={editing.tags}
										{availableTags}
										disabled={busy}
									/>
									<div class="buttons">
										<Button class="sm" disabled={busy} onclick={saveEditing}>Save</Button>
										<Button
											class="sm"
											--bg="var(--color-input-background)"
											--text="var(--color-text-primary)"
											disabled={busy}
											onclick={() => (editing = null)}>Cancel</Button
										>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Like the settings' other rows, whose styles are Settings.svelte's own. */
	.preferenceItem {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		min-height: 3rem;
		padding: var(--spacing-sm) var(--spacing-md);
		background-color: #fff1;

		&:nth-child(2) {
			border-radius: var(--radius-md) var(--radius-md) 0 0;
		}
		&:last-child {
			border-radius: 0 0 var(--radius-md) var(--radius-md);
		}
		&:nth-child(2):last-child {
			border-radius: var(--radius-md);
		}

		label {
			font-weight: 500;
			min-width: min(200px, 50%);
		}

		p {
			font-size: 0.8rem;
			color: var(--color-text-muted);
			line-height: 1.2;
		}
	}

	.label,
	.name {
		font-weight: 500;
	}

	.problem {
		color: var(--color-red) !important;
	}

	code {
		display: inline-block;
		margin-top: var(--spacing-xs);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.clients {
		> div {
			flex: 1;
		}

		ul {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-sm);
			margin-top: var(--spacing-sm);
		}

		li {
			border-left: var(--color-yellow) 4px solid;
			padding: var(--spacing-sm) var(--spacing-md);
			background-color: #fff1;
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.client {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--spacing-md);
		}

		.access {
			margin-top: var(--spacing-xs);
			color: var(--color-text-secondary);
		}

		.buttons {
			display: flex;
			flex-wrap: wrap;
			gap: var(--spacing-sm);
		}

		.editing {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
		}
	}
</style>

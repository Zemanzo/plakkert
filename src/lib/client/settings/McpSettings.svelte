<script lang="ts">
	import { onMount } from 'svelte';
	import { MCP_PATH } from '#lib/mcp.js';
	import Button from '../components/Button.svelte';
	import { confirmation } from '../components/Confirmation.svelte';

	// Whether MCP clients, such as AI assistants, may read the user's notes, and which ones do.
	// Kept on the server, so it needs a connection. See src/lib/server/mcp/.

	let {
		onAvailable
	}: {
		/** Tells whether the server allows MCP at all (its MCP environment variable). */
		onAvailable: (available: boolean) => void;
	} = $props();

	type Client = { id: string; clientName: string; createdAt: string; lastUsedAt: string | null };

	let enabled = $state<boolean | null>(null);
	let clients = $state<Client[]>([]);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let copied = $state(false);

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
		<label for="mcp-enabled">Let MCP clients read your notes</label>
		<p>
			Apps that speak MCP, such as AI assistants, can then search and read your notes once you
			connect them, but can’t change anything. As your notes are end-to-end encrypted, this server
			decrypts them for a connected app while it reads them, with a key that only that app has.
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
						<li>
							<div>
								<span class="name">{client.clientName}</span>
								<p>
									Connected {formatDate(client.createdAt)} · {client.lastUsedAt
										? `last used ${formatDate(client.lastUsedAt)}`
										: 'not used yet'}
								</p>
							</div>
							<Button
								class="sm"
								--bg="var(--color-input-background)"
								--text="var(--color-text-primary)"
								disabled={busy}
								onclick={() => disconnect(client)}>Disconnect</Button
							>
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
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--spacing-md);
		}
	}
</style>

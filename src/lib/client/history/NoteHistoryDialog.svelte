<script lang="ts">
	import XIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import type { NoteData } from '../Database';
	import NotePreview from '../editor/NotePreview.svelte';
	import { formatFullTime, formatVersionTime } from '../note/EditedTime';
	import { loadHistory, type HistoryVersion, type NoteHistory } from './NoteHistory';

	// The earlier versions of a note, to look at and restore. They're fetched when this opens.

	let {
		open = $bindable(false),
		noteId,
		noteKey,
		userId,
		current,
		canEdit,
		onRestore
	}: {
		open: boolean;
		noteId: string;
		noteKey: Uint8Array;
		userId: string;
		/** The note as it is now. */
		current: { data: NoteData; updatedAt: Date };
		canEdit: boolean;
		onRestore: (version: HistoryVersion) => Promise<void>;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let history = $state<NoteHistory | null>(null);
	let problem = $state<string | null>(null);
	/** The `updatedAt` of the version that is shown, or null for the note as it is now. */
	let selectedAt = $state<number | null>(null);
	let restoring = $state(false);

	const selected = $derived(
		selectedAt === null
			? null
			: (history?.versions.find((version) => version.updatedAt.getTime() === selectedAt) ?? null)
	);
	const shown = $derived(selected?.data ?? current.data);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			void load();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	async function load() {
		history = null;
		problem = null;
		selectedAt = null;
		try {
			const loaded = await loadHistory(
				userId,
				{ id: noteId, updatedAt: current.updatedAt },
				noteKey
			);
			history = loaded;
			selectedAt = loaded.versions[0]?.updatedAt.getTime() ?? null;
		} catch (error) {
			console.error(error);
			problem = 'The history couldn’t be loaded. Try again later.';
		}
	}

	async function restore() {
		if (!selected) return;
		restoring = true;
		try {
			await onRestore(selected);
			open = false;
		} finally {
			restoring = false;
		}
	}
</script>

<!-- The note behind this reacts to clicks and keys, e.g. by opening; they stay in here. -->
<dialog
	bind:this={dialog}
	aria-labelledby="historyTitle"
	onclose={() => {
		open = false;
		history = null;
	}}
	onclick={(event) => {
		event.stopPropagation();
		// A click on the backdrop lands on the dialog itself.
		if (event.target === dialog) open = false;
	}}
	onkeydown={(event) => event.stopPropagation()}
>
	<!-- Only while open, so the decrypted versions don't stay around once it's closed. -->
	{#if open}
		<div class="content">
			<header>
				<h2 id="historyTitle">History</h2>
				<button class="close" aria-label="Close" title="Close" onclick={() => (open = false)}>
					<XIcon width="20px" />
				</button>
			</header>

			{#if problem}
				<p class="notice">{problem}</p>
			{:else if !history}
				<p class="notice">Loading…</p>
			{:else if history.ownerStopped}
				<p class="notice">The owner of this note doesn’t keep its history.</p>
			{:else}
				{#if history.offline}
					<p class="notice">You’re offline, so only the versions on this device are shown.</p>
				{/if}
				{#if history.failed > 0}
					<p class="notice">
						{history.failed === 1 ? '1 version' : `${history.failed} versions`} couldn’t be read.
					</p>
				{/if}
				{#if history.versions.length === 0}
					<p class="notice">
						There are no earlier versions yet. The note is kept as it was each time you start
						changing it after a break of 10 minutes or more.
					</p>
				{:else}
					<div class="layout">
						<ul class="versions" aria-label="Versions">
							<li>
								<button
									aria-pressed={selectedAt === null}
									title={formatFullTime(current.updatedAt)}
									onclick={() => (selectedAt = null)}
								>
									<span class="when">Current version</span>
									<span class="detail">{formatVersionTime(current.updatedAt)}</span>
								</button>
							</li>
							{#each history.versions as version (version.updatedAt.getTime())}
								<li>
									<button
										aria-pressed={selectedAt === version.updatedAt.getTime()}
										title={formatFullTime(version.updatedAt)}
										onclick={() => (selectedAt = version.updatedAt.getTime())}
									>
										<span class="when">{formatVersionTime(version.updatedAt)}</span>
									</button>
								</li>
							{/each}
						</ul>
						<div class="preview" style="--bg: var(--color-{shown.meta.color})">
							{#key shown}
								<NotePreview html={shown.content} />
							{/key}
						</div>
					</div>
					{#if canEdit}
						<div class="buttons">
							<Button class="sm" disabled={!selected || restoring} onclick={restore}>
								Restore this version
							</Button>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		/* Tailwind's reset removes the margin that centers dialogs. */
		margin: auto;
		width: min(56rem, calc(100vw - 2 * var(--spacing-lg)));
		max-height: calc(100dvh - 2 * var(--spacing-lg));
		padding: var(--spacing-xl);
		border: none;
		border-radius: var(--radius-lg);
		background: var(--color-background-header);
		color: var(--color-text-primary);
		box-shadow: 0 8px 32px #0006;
		cursor: default;

		&::backdrop {
			background: #0008;
		}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;

		h2 {
			margin: 0;
		}
	}

	.close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		cursor: pointer;

		&:hover {
			background: #8883;
		}
	}

	.notice {
		margin: 0;
		line-height: 1.4;
	}

	.layout {
		display: grid;
		grid-template-columns: 15rem 1fr;
		gap: var(--spacing-md);
		height: min(32rem, calc(100dvh - 14rem));
	}

	.versions {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;

		button {
			display: flex;
			flex-direction: column;
			width: 100%;
			padding: var(--spacing-sm) var(--spacing-md);
			border-radius: var(--radius-sm);
			text-align: left;
			cursor: pointer;

			&:hover {
				background: #8882;
			}

			&[aria-pressed='true'] {
				background: #8884;
			}
		}

		.detail {
			font-size: 0.8rem;
			opacity: 0.8;
		}
	}

	.preview {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		padding: var(--spacing-md) var(--spacing-xl);
		border-radius: var(--radius-md);
		background: var(--bg, var(--color-yellow));
		color: #161616;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 600px) {
		dialog {
			padding: var(--spacing-lg);
		}

		.layout {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
			height: calc(100dvh - 12rem);
		}

		.versions {
			max-height: 9rem;
		}
	}
</style>

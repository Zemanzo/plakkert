<script lang="ts">
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CheckIcon from '@iconify-svelte/lucide/check';
	import PencilIcon from '@iconify-svelte/lucide/pencil';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import { confirmation } from '../components/Confirmation.svelte';
	import type { NoteStore } from '../note/NoteStore.svelte';
	import type { RuntimeUser } from '#lib/types.js';
	import {
		findExistingTag,
		hasTag,
		MAX_TAG_LENGTH,
		normalizeTagName,
		validateTagName,
		withoutTag,
		withRenamedTag,
		type NoteTags
	} from './Tags';
	import { updateTags } from './TagsCRUD';
	import { tagHref } from './TagLinks';

	const user = getContext<() => RuntimeUser>('user')();
	const store = getContext<() => NoteStore>('notes')();

	let dialog = $state<HTMLDialogElement>();
	let editing = $state<string | null>(null);
	let draft = $state('');
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	export function open() {
		editing = null;
		errorMessage = null;
		dialog?.showModal();
	}

	/** Changes a tag on every note that has it, including notes in the trash. */
	async function updateEveryNote(tag: string, update: (tags: NoteTags) => NoteTags) {
		const entries = (store.entries ?? []).filter((entry) => hasTag(entry.tags, tag));
		await Promise.all(
			entries.map((entry) => updateTags(entry.note.id, user.id, entry.noteKey, update))
		);
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		errorMessage = null;
		try {
			await action();
		} catch (error) {
			console.error(error);
			errorMessage = error instanceof Error ? error.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	function startEditing(tag: string) {
		editing = tag;
		draft = tag;
		errorMessage = null;
	}

	const viewedTag = () => (page.url.pathname === '/' ? page.url.searchParams.get('tag') : null);

	function rename(event: SubmitEvent, from: string) {
		event.preventDefault();
		const name = normalizeTagName(draft);
		const error = validateTagName(name);
		if (error) {
			errorMessage = error;
			return;
		}
		// Renaming onto another tag (in any case) merges the two.
		const others = store.tags.map((tag) => tag.name).filter((tag) => tag !== from);
		const to = findExistingTag(others, name) ?? name;

		return run(async () => {
			if (to !== from) {
				await updateEveryNote(from, (tags) => withRenamedTag(tags, from, to));
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it
				if (viewedTag() === from) await goto(tagHref(to), { replaceState: true });
			}
			editing = null;
		});
	}

	async function remove(tag: string) {
		const count = (store.entries ?? []).filter((entry) => hasTag(entry.tags, tag)).length;
		const confirmed = await confirmation.ask({
			title: `Delete “${tag}”?`,
			message: `The tag is removed from ${count === 1 ? '1 note' : `${count} notes`}. The notes themselves are kept.`,
			confirmLabel: 'Delete tag',
			danger: true
		});
		if (!confirmed) return;
		await run(async () => {
			await updateEveryNote(tag, (tags) => withoutTag(tags, tag));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it
			if (viewedTag() === tag) await goto(tagHref(null), { replaceState: true });
		});
	}
</script>

<dialog bind:this={dialog} aria-labelledby="tagsDialogTitle">
	<h2 id="tagsDialogTitle">Edit tags</h2>
	{#if store.tags.length === 0}
		<p>You don’t have any tags. Add them to a note from its tag menu.</p>
	{:else}
		<ul>
			{#each store.tags as tag (tag.name)}
				<li>
					{#if editing === tag.name}
						<form onsubmit={(event) => rename(event, tag.name)}>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								aria-label={`New name for ${tag.name}`}
								maxlength={MAX_TAG_LENGTH + 10}
								bind:value={draft}
								readonly={busy}
								autofocus
							/>
							<button type="submit" aria-label="Save" title="Save" disabled={busy}>
								<CheckIcon width="18px" />
							</button>
							<button
								type="button"
								aria-label="Cancel"
								title="Cancel"
								disabled={busy}
								onclick={() => (editing = null)}
							>
								<CloseIcon width="18px" />
							</button>
						</form>
					{:else}
						<span class="name">{tag.name}</span>
						<span class="count" title="Notes with this tag">{tag.count}</span>
						<button
							aria-label={`Rename ${tag.name}`}
							title="Rename"
							disabled={busy}
							onclick={() => startEditing(tag.name)}
						>
							<PencilIcon width="18px" />
						</button>
						<button
							aria-label={`Delete ${tag.name}`}
							title="Delete"
							disabled={busy}
							onclick={() => remove(tag.name)}
						>
							<TrashIcon width="18px" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}
	<form method="dialog" class="done">
		<Button class="sm">Done</Button>
	</form>
</dialog>

<style>
	dialog {
		/* Tailwind's reset removes the margin that centers dialogs. */
		margin: auto;
		width: min(24rem, calc(100vw - 2 * var(--spacing-lg)));
		max-height: min(32rem, calc(100vh - 2 * var(--spacing-xl)));
		padding: var(--spacing-xl);
		border: none;
		border-radius: var(--radius-lg);
		background: var(--color-background-header);
		color: var(--color-text-primary);
		box-shadow: 0 8px 32px #0006;

		&[open] {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
		}

		&::backdrop {
			background: #0008;
		}
	}

	h2 {
		margin: 0;
	}

	p {
		margin: 0;

		&.error {
			color: var(--color-red);
		}
	}

	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	li,
	li form {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		min-height: 2.5rem;
	}

	li form {
		flex: 1;

		input {
			flex: 1;
			min-width: 0;
		}
	}

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		font-size: 0.85rem;
		opacity: 0.6;
	}

	li button {
		display: flex;
		padding: var(--spacing-sm);
		border-radius: 50%;
		cursor: pointer;

		&:hover:not(:disabled) {
			background-color: #8883;
		}

		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}

	.done {
		display: flex;
		justify-content: flex-end;
	}
</style>

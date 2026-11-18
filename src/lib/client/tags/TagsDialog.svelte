<script lang="ts">
	import { getContext, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import GripIcon from '@iconify-svelte/lucide/grip-vertical';
	import ArrowLeftIcon from '@iconify-svelte/lucide/arrow-left';
	import MergeIcon from '@iconify-svelte/lucide/merge';
	import TrashIcon from '@iconify-svelte/lucide/trash-2';
	import UndoIcon from '@iconify-svelte/lucide/undo-2';
	import CloseIcon from '@iconify-svelte/lucide/x';
	import Button from '../components/Button.svelte';
	import type { NoteStore } from '../note/NoteStore.svelte';
	import { updateSyncedSettings } from '../settings/SyncedSettings';
	import type { RuntimeUser } from '#lib/types.js';
	import { planTagEdits, type TagRow } from './TagEdits';
	import { hasTag, MAX_TAG_LENGTH, withChangedTags } from './Tags';
	import { updateTagsOfNotes } from './TagsCRUD';
	import { tagHref } from './TagLinks';

	const user = getContext<() => RuntimeUser>('user')();
	const store = getContext<() => NoteStore>('notes')();

	let dialog = $state<HTMLDialogElement>();
	let rows = $state<TagRow[]>([]);
	let counts = $state<Record<string, number>>({});
	/** Whether the tags were moved, so their order is saved. */
	let reordered = $state(false);
	/** Whether to show the errors, which waits until trying to save. */
	let showErrors = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	/** Read by screen readers, e.g. where a tag was moved to. */
	let announcement = $state('');

	const plan = $derived(planTagEdits(rows));
	const hasChanges = $derived(
		reordered || rows.some((row) => row.deleted || row.mergeInto || row.name !== row.original)
	);

	export function open() {
		rows = store.tags.map((tag) => ({
			original: tag.name,
			name: tag.name,
			mergeInto: null,
			deleted: false
		}));
		counts = Object.fromEntries(store.tags.map((tag) => [tag.name, tag.count]));
		reordered = false;
		merging = null;
		showErrors = false;
		errorMessage = null;
		announcement = '';
		dialog?.showModal();
	}

	const removedFrom = (count: number) =>
		count === 1
			? 'Removed from 1 note, which is kept.'
			: `Removed from ${count} notes, which are kept.`;

	// Merging: the merge button of a tag starts choosing the tag to merge it into, among the others.

	/** The tag being merged, while choosing the tag to merge it into. */
	let merging = $state<TagRow | null>(null);

	const isKept = (row: TagRow) => !row.deleted && !row.mergeInto;
	const canMerge = $derived(rows.filter(isKept).length > 1);

	function startMerging(row: TagRow) {
		merging = row;
		announcement = `Choose the tag to merge ${row.original} into`;
	}

	function stopMerging() {
		merging = null;
		announcement = 'Merging cancelled';
	}

	function mergeInto(target: TagRow) {
		if (!merging) return;
		const row = merging;
		row.mergeInto = target.original;
		merging = null;
		announcement = `${row.original} will be merged into ${plan.outcomes[rows.indexOf(row)].name}`;
	}

	/** Escape stops merging, rather than closing the dialog. */
	function onCancel(event: Event) {
		if (!merging) return;
		event.preventDefault();
		stopMerging();
	}

	// Reordering, by dragging the handle, or with the arrow keys while it's focused.

	let list = $state<HTMLUListElement>();
	let draggedRow = $state<TagRow | null>(null);

	async function move(row: TagRow, to: number, refocus = false) {
		const from = rows.indexOf(row);
		to = Math.max(0, Math.min(rows.length - 1, to));
		if (from === to) return;
		rows.splice(from, 1);
		rows.splice(to, 0, row);
		reordered = true;
		announcement = `${row.original} moved to position ${to + 1} of ${rows.length}`;
		if (refocus) {
			// Moving the row in the page can take the focus away from its handle.
			await tick();
			list?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(row.original)}"]`)?.focus();
		}
	}

	function onHandleKeydown(row: TagRow, event: KeyboardEvent) {
		const index = rows.indexOf(row);
		const to = {
			ArrowUp: index - 1,
			ArrowDown: index + 1,
			Home: 0,
			End: rows.length - 1
		}[event.key];
		if (to === undefined) return;
		event.preventDefault();
		void move(row, to, true);
	}

	/**
	 * Starts dragging a tag by its handle. The pointer is followed on the window: capturing it on
	 * the handle would end as soon as its row moves in the page.
	 */
	function onHandlePointerdown(row: TagRow, event: PointerEvent) {
		if (event.button !== 0 || busy) return;
		event.preventDefault();
		draggedRow = row;
		const { pointerId } = event;
		const onMove = (event: PointerEvent) => {
			if (event.pointerId === pointerId) dragTo(row, event.clientY);
		};
		const onEnd = (event: PointerEvent) => {
			if (event.pointerId !== pointerId) return;
			draggedRow = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onEnd);
			window.removeEventListener('pointercancel', onEnd);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onEnd);
		window.addEventListener('pointercancel', onEnd);
	}

	/** Moves the dragged tag to where the pointer is, among the other tags. */
	function dragTo(row: TagRow, clientY: number) {
		if (!list) return;
		// Positions in the list's layout, which (unlike the rows' boxes) don't change while the
		// rows animate to their new place.
		const y = clientY - list.getBoundingClientRect().top + list.scrollTop;
		const from = rows.indexOf(row);
		let to = 0;
		for (const [index, item] of ([...list.children] as HTMLElement[]).entries()) {
			if (index === from) continue;
			if (y > item.offsetTop + item.offsetHeight / 2) to = index < from ? index + 1 : index;
		}
		void move(row, to);
	}

	// Saving.

	const viewedTag = () => (page.url.pathname === '/' ? page.url.searchParams.get('tag') : null);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (merging) return;
		if (!hasChanges) {
			dialog?.close();
			return;
		}
		showErrors = true;
		if (plan.hasErrors) return;
		const { changes, order } = plan;

		busy = true;
		errorMessage = null;
		try {
			if (changes.size > 0) {
				const noteKeys = new Map(
					(store.entries ?? [])
						.filter((entry) => [...changes.keys()].some((tag) => hasTag(entry.tags, tag)))
						.map((entry) => [entry.note.id, entry.noteKey])
				);
				await updateTagsOfNotes(user.id, noteKeys, (tags) => withChangedTags(tags, changes));
			}
			// Only once the order was changed: until then, tags are sorted by name, also new ones.
			if (reordered || store.settings.tagOrder.length > 0) {
				await updateSyncedSettings(user, (settings) => ({ ...settings, tagOrder: order }));
			}
			const viewed = viewedTag();
			if (viewed !== null && changes.has(viewed)) {
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it
				await goto(tagHref(changes.get(viewed)!), { replace: true, state: page.state });
			}
			dialog?.close();
		} catch (error) {
			console.error(error);
			errorMessage = error instanceof Error ? error.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<dialog bind:this={dialog} aria-labelledby="tagsDialogTitle" oncancel={onCancel}>
	<form onsubmit={save} class:isMerging={merging !== null}>
		<h2 id="tagsDialogTitle">Edit tags</h2>
		{#if rows.length === 0}
			<p>You don’t have any tags. Add them to a note from its tag menu.</p>
		{:else}
			<p class="hint">
				{#if merging}
					Choose the tag to merge “{merging.original}” into, with <ArrowLeftIcon
						width="14px"
						aria-label="the arrow"
					/>.
				{:else}
					Drag <GripIcon width="14px" aria-label="the handle" /> to reorder. Giving a tag the name of
					another one merges them.
				{/if}
			</p>
			<ul bind:this={list}>
				{#each rows as row, index (row.original)}
					{@const outcome = plan.outcomes[index]}
					<!-- While merging, everything but choosing the tag to merge into is hidden or disabled,
					     keeping every row in its place. -->
					<li
						animate:flip={{ duration: draggedRow ? 100 : 200 }}
						class:dragged={draggedRow === row}
						class:merging={merging === row}
					>
						<div class="row">
							<button
								type="button"
								class="handle"
								class:hidden={merging}
								data-handle={row.original}
								aria-label={`Move ${row.original}`}
								title="Drag, or use the arrow keys, to move"
								disabled={busy || merging !== null}
								onkeydown={(event) => onHandleKeydown(row, event)}
								onpointerdown={(event) => onHandlePointerdown(row, event)}
							>
								<GripIcon width="18px" />
							</button>
							{#if row.deleted || row.mergeInto}
								<span class="name removed">{row.original}</span>
								<button
									type="button"
									class:hidden={merging}
									aria-label={`Undo ${row.deleted ? 'deleting' : 'merging'} ${row.original}`}
									title="Undo"
									disabled={busy || merging !== null}
									onclick={() => {
										row.deleted = false;
										row.mergeInto = null;
									}}
								>
									<UndoIcon width="18px" />
								</button>
							{:else}
								<input
									aria-label={`Name of ${row.original}`}
									aria-invalid={showErrors && outcome.error !== null}
									maxlength={MAX_TAG_LENGTH + 10}
									bind:value={row.name}
									readonly={busy}
									disabled={merging !== null}
								/>
								<span class="count" title="Notes with this tag">{counts[row.original]}</span>
								{#if merging || canMerge}
									<!-- One button that changes, so it keeps the focus when merging starts or stops. -->
									<button
										type="button"
										class="mergeButton"
										class:target={merging && merging !== row}
										aria-label={merging === row
											? `Stop merging ${row.original}`
											: merging
												? `Merge ${merging.original} into ${row.name}`
												: `Merge ${row.original} into another tag`}
										title={merging === row
											? 'Stop merging'
											: merging
												? `Merge “${merging.original}” into this tag`
												: 'Merge into another tag'}
										disabled={busy}
										onclick={() =>
											merging === row
												? stopMerging()
												: merging
													? mergeInto(row)
													: startMerging(row)}
									>
										{#if merging === row}
											<CloseIcon width="18px" />
										{:else if merging}
											<ArrowLeftIcon width="18px" />
										{:else}
											<MergeIcon width="18px" />
										{/if}
									</button>
								{/if}
								<button
									type="button"
									class:hidden={merging}
									aria-label={`Delete ${row.original}`}
									title="Delete"
									disabled={busy || merging !== null}
									onclick={() => (row.deleted = true)}
								>
									<TrashIcon width="18px" />
								</button>
							{/if}
						</div>
						{#if row.deleted}
							<p class="status">{removedFrom(counts[row.original])}</p>
						{:else if outcome.name === null}
							<p class="status">Deleted, as the tag it’s merged into is deleted.</p>
						{:else if outcome.mergesWith}
							<p class="status">Merges with “{outcome.mergesWith}”.</p>
						{:else if showErrors && outcome.error}
							<p class="status error">{outcome.error}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
		<p class="visuallyHidden" aria-live="polite">{announcement}</p>
		<div class="buttons">
			{#if rows.length > 0}
				<Button
					type="button"
					class="sm"
					--bg="var(--color-input-background)"
					--text="var(--color-text-primary)"
					disabled={busy}
					onclick={() => dialog?.close()}
				>
					Cancel
				</Button>
				<Button class="sm" disabled={busy || merging !== null}>{busy ? 'Saving…' : 'Save'}</Button>
			{:else}
				<Button type="button" class="sm" onclick={() => dialog?.close()}>Close</Button>
			{/if}
		</div>
	</form>
</dialog>

<style>
	dialog {
		/* Tailwind's reset removes the margin that centers dialogs. */
		margin: auto;
		width: min(26rem, calc(100vw - 2 * var(--spacing-lg)));
		max-height: min(36rem, calc(100vh - 2 * var(--spacing-xl)));
		padding: var(--spacing-xl);
		border: none;
		border-radius: var(--radius-lg);
		background: var(--color-background-header);
		color: var(--color-text-primary);
		box-shadow: 0 8px 32px #0006;

		&[open] {
			display: flex;
		}

		&::backdrop {
			background: #0008;
		}
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		flex: 1;
		min-height: 0;
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

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-secondary);

		:global(svg) {
			display: inline;
			vertical-align: -2px;
		}
	}

	ul {
		/* So the rows' offsetTop is measured from the list. */
		position: relative;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	li {
		border-radius: var(--radius-md, 0.5rem);

		&.dragged {
			background-color: #8882;
		}

		/* The tag being merged into another one. */
		&.merging input {
			border: 1px solid var(--color-yellow);
		}
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		min-height: 2.75rem;

		input {
			flex: 1;
			min-width: 0;
		}
	}

	.name {
		flex: 1;
		padding-inline: var(--spacing-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&.removed {
			text-decoration: line-through;
			opacity: 0.6;
		}
	}

	.count {
		min-width: 1.5rem;
		font-size: 0.85rem;
		text-align: end;
		opacity: 0.6;
	}

	.status {
		/* Lined up with the name, past the handle. */
		padding: 0 0 var(--spacing-sm) calc(18px + 3 * var(--spacing-sm));
		font-size: 0.75rem;
		color: var(--color-text-muted);

		&.error {
			opacity: 1;
		}
	}

	.row button {
		display: flex;
		flex-shrink: 0;
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

		/* Hidden while merging, but still taking up their space, so nothing moves. */
		&.hidden {
			visibility: hidden;
		}
	}

	/* The tags that can be merged into. */
	.mergeButton.target:hover {
		background-color: #8883;
	}

	.isMerging input:disabled {
		opacity: 0.7;
		color: var(--color-text-primary);
	}

	/* The tag being merged reads normally, as it's highlighted. */
	.merging input:disabled {
		opacity: 1;
		color: var(--color-text-primary);
	}

	.handle {
		cursor: grab;
		/* So dragging on a touch screen moves the tag rather than scrolling. */
		touch-action: none;

		.dragged & {
			cursor: grabbing;
		}
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);

		:global(button.sm) {
			padding: 6px var(--spacing-lg);
		}
	}

	.visuallyHidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>

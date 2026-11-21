<script lang="ts">
	import { compareTags } from '../tags/Tags';
	import {
		MAX_FILTER_TAGS,
		READ_DEPENDENT_PERMISSIONS,
		type McpPermissions,
		type McpTagFilter
	} from '#lib/mcp.js';

	// What a connected MCP app may do: read, with or without hidden notes and limited by tags, and
	// write, in parts. Everything that writes to existing notes needs read, and only reaches the
	// notes read does. Used when connecting an app, and in the settings.

	let {
		permissions = $bindable(),
		tags = $bindable(),
		availableTags,
		disabled = false,
		id
	}: {
		permissions: McpPermissions;
		/** The tags `permissions.tagMode` applies to. Empty for all notes. */
		tags: McpTagFilter;
		/** The user's tags, to choose from. */
		availableTags: string[];
		disabled?: boolean;
		/** Makes the ids of the inputs unique, when there are several editors. */
		id: string;
	} = $props();

	type WriteFlag = 'create' | (typeof READ_DEPENDENT_PERMISSIONS)[number];
	const WRITES: { flag: WriteFlag; label: string; hint: string }[] = [
		{ flag: 'create', label: 'Create notes', hint: 'Doesn’t need Read' },
		{ flag: 'edit', label: 'Edit', hint: 'Change the text of notes' },
		{ flag: 'delete', label: 'Delete', hint: 'Move notes to the trash, and restore them' },
		{
			flag: 'organize',
			label: 'Tag, colour, archive and hide',
			hint: 'And untag, unarchive and unhide'
		},
		{ flag: 'share', label: 'Share', hint: 'Share your own notes with others, and stop sharing' }
	];

	const writeCount = $derived(WRITES.filter(({ flag }) => permissions[flag]).length);
	// Read can still be turned on later, so only what's possible counts towards "all".
	const possibleWrites = $derived(
		WRITES.filter(({ flag }) => flag === 'create' || permissions.read)
	);

	function setRead(read: boolean) {
		permissions.read = read;
		if (!read) {
			permissions.readHidden = false;
			for (const flag of READ_DEPENDENT_PERMISSIONS) permissions[flag] = false;
		}
	}

	function setAllWrites(on: boolean) {
		for (const { flag } of possibleWrites) permissions[flag] = on;
	}

	// Tags that are chosen but no longer used still show, so they can be taken out.
	const tagOptions = $derived([...new Set([...availableTags, ...tags])].sort(compareTags));
	let tagQuery = $state('');
	const shownTags = $derived(
		tagOptions.filter((tag) =>
			tag.toLocaleLowerCase().includes(tagQuery.trim().toLocaleLowerCase())
		)
	);
	let picker = $state<HTMLDetailsElement>();

	/** A filter can only have so many tags; one with more can't be used. */
	const full = $derived(tags.length >= MAX_FILTER_TAGS);

	function toggleTag(tag: string, on: boolean) {
		if (on && (full || tags.includes(tag))) return;
		tags = on ? [...tags, tag] : tags.filter((t) => t !== tag);
	}

	/** Closes the tag list when clicking or focusing elsewhere. */
	function closeOutside(event: Event) {
		if (picker?.open && !picker.contains(event.target as Node)) picker.open = false;
	}

	const tagSummary = $derived(
		tags.length === 0 ? 'Choose tags' : [...tags].sort(compareTags).join(', ')
	);
	const filterHint = $derived(
		!permissions.read
			? ''
			: tags.length === 0
				? 'No tags chosen: all notes.'
				: permissions.tagMode === 'include'
					? 'Only notes with at least one of these tags.'
					: 'All notes, except those with any of these tags.'
	);
</script>

<svelte:window onclick={closeOutside} onfocusin={closeOutside} />

<fieldset class="permissions" {disabled}>
	<legend class="sr-only">Permissions</legend>

	<div class="group">
		<label class="main">
			<input
				class="themedCheckbox"
				type="checkbox"
				checked={permissions.read}
				onchange={(event) => setRead(event.currentTarget.checked)}
			/>
			<span>
				<span class="name">Read</span>
				<span class="hint">Search and read notes and tags</span>
			</span>
		</label>
		<div class="sub">
			<label>
				<input
					class="themedCheckbox"
					type="checkbox"
					bind:checked={permissions.readHidden}
					disabled={!permissions.read}
				/>
				<span>Also hidden notes</span>
			</label>
			<div class="tagFilter">
				<select
					id="{id}-tag-mode"
					aria-label="Include or exclude notes with these tags"
					bind:value={permissions.tagMode}
					disabled={!permissions.read}
				>
					<option value="include">Include</option>
					<option value="exclude">Exclude</option>
				</select>
				<details class="tagPicker" bind:this={picker}>
					<summary
						aria-label="Tags to {permissions.tagMode}"
						class:disabled={!permissions.read}
						onclick={(event) => {
							if (!permissions.read || disabled) event.preventDefault();
						}}
					>
						<span>{tagSummary}</span>
					</summary>
					<div class="tagList">
						{#if tagOptions.length > 6}
							<input
								aria-label="Find a tag"
								placeholder="Find a tag"
								autocomplete="off"
								bind:value={tagQuery}
							/>
						{/if}
						{#if full}
							<p>A filter can have at most {MAX_FILTER_TAGS} tags.</p>
						{/if}
						{#if tagOptions.length === 0}
							<p>You have no tags yet.</p>
						{:else}
							<ul role="group" aria-label="Tags">
								{#each shownTags as tag (tag)}
									<li>
										<label>
											<input
												class="themedCheckbox"
												type="checkbox"
												checked={tags.includes(tag)}
												disabled={full && !tags.includes(tag)}
												onchange={(event) => toggleTag(tag, event.currentTarget.checked)}
											/>
											<span>{tag}</span>
											{#if !availableTags.includes(tag)}
												<span class="unused">not used</span>
											{/if}
										</label>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</details>
			</div>
			{#if filterHint}
				<p class="hint">{filterHint}</p>
			{/if}
		</div>
	</div>

	<div class="group">
		<label class="main">
			<input
				class="themedCheckbox"
				type="checkbox"
				checked={writeCount > 0 && writeCount === possibleWrites.length}
				aria-checked={writeCount > 0 && writeCount < possibleWrites.length ? 'mixed' : undefined}
				{@attach (input) => {
					input.indeterminate = writeCount > 0 && writeCount < possibleWrites.length;
				}}
				onchange={(event) => setAllWrites(event.currentTarget.checked)}
			/>
			<span>
				<span class="name">Write</span>
				<span class="hint"
					>Change notes; all but creating needs Read, and only reaches what it reads</span
				>
			</span>
		</label>
		<div class="sub">
			{#each WRITES as { flag, label, hint } (flag)}
				<label>
					<input
						class="themedCheckbox"
						type="checkbox"
						bind:checked={permissions[flag]}
						disabled={flag !== 'create' && !permissions.read}
					/>
					<span>
						<span>{label}</span>
						<span class="hint">{hint}</span>
					</span>
				</label>
			{/each}
		</div>
	</div>
</fieldset>

<style>
	.permissions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	label {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-sm);
		cursor: pointer;

		> span {
			display: flex;
			flex-direction: column;
		}

		input {
			flex-shrink: 0;
			margin-top: 0.1em;
		}
	}

	.name {
		font-weight: 500;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		line-height: 1.2;
	}

	.sub {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-left: var(--spacing-lg);
	}

	.tagFilter {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--spacing-sm);
	}

	select,
	summary {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		background: var(--color-input-background);
	}

	select:disabled,
	summary.disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.tagPicker {
		position: relative;
		flex: 1;
		min-width: 10rem;

		summary {
			cursor: pointer;
			list-style: none;

			span {
				display: block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			&::after {
				content: '▾';
				position: absolute;
				right: var(--spacing-sm);
				top: var(--spacing-xs);
			}

			&::-webkit-details-marker {
				display: none;
			}
		}

		summary span {
			padding-right: var(--spacing-lg);
		}
	}

	.tagList {
		position: absolute;
		z-index: 20;
		top: calc(100% + var(--spacing-xs));
		left: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		width: min(16rem, 80vw);
		padding: var(--spacing-sm);
		border-radius: var(--radius-md);
		background: var(--color-background-header);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);

		input:not([type='checkbox']) {
			width: 100%;
			box-sizing: border-box;
		}

		ul {
			display: flex;
			flex-direction: column;
			max-height: 14rem;
			overflow-y: auto;
			margin: 0;
			padding: 0;
			list-style: none;
		}

		label {
			align-items: center;
			padding: var(--spacing-xs) var(--spacing-sm);
			border-radius: var(--radius-sm);

			&:hover {
				background-color: #8882;
			}
		}

		.unused {
			margin-left: auto;
			font-size: 0.75rem;
			color: var(--color-text-muted);
		}

		p {
			margin: 0;
			font-size: 0.9rem;
			opacity: 0.8;
		}
	}
</style>

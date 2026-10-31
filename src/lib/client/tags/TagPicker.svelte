<script lang="ts">
	import {
		compareTags,
		findExistingTag,
		MAX_TAG_LENGTH,
		normalizeTagName,
		userTags,
		validateTagName,
		withoutTag,
		withTag,
		type NoteTags
	} from './Tags';

	let {
		tags,
		allTags,
		onChange
	}: {
		/** The note's current tags. */
		tags: NoteTags;
		/** All tags the user has, to pick from. */
		allTags: string[];
		onChange: (update: (tags: NoteTags) => NoteTags) => void;
	} = $props();

	let query = $state('');

	const noteTags = $derived(userTags(tags));
	const name = $derived(normalizeTagName(query));
	// A tag can be on this note without being in allTags yet, e.g. right after adding it.
	const knownTags = $derived([...new Set([...allTags, ...noteTags])].sort(compareTags));
	const existing = $derived(name ? findExistingTag(knownTags, name) : undefined);
	const error = $derived(name && !existing ? validateTagName(name) : null);
	const options = $derived(
		knownTags.filter((tag) => tag.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
	);

	function toggle(tag: string, checked: boolean) {
		onChange((current) => (checked ? withTag(current, tag) : withoutTag(current, tag)));
	}

	/** Adds the typed tag, reusing an existing tag that only differs in case. */
	function add() {
		if (!name || error) return;
		const tag = existing ?? name;
		onChange((current) => withTag(current, tag));
		query = '';
	}

	function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		add();
	}
</script>

<section>
	<h3>Tags</h3>
	<form {onsubmit}>
		<input
			aria-label="Tag name"
			placeholder="Find or create a tag"
			autocomplete="off"
			maxlength={MAX_TAG_LENGTH + 10}
			bind:value={query}
		/>
	</form>
	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if options.length > 0}
		<ul>
			{#each options as tag (tag)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={noteTags.includes(tag)}
							onchange={(event) => toggle(tag, event.currentTarget.checked)}
						/>
						<span>{tag}</span>
					</label>
				</li>
			{/each}
		</ul>
	{:else if !name}
		<p>No tags yet. Type a name to create one.</p>
	{/if}

	{#if name && !existing && !error}
		<button class="create" type="button" onclick={add}>
			+ Create “{name}”
		</button>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: min(16rem, 80vw);
		padding: var(--spacing-sm);
	}

	h3 {
		margin: 0;
		font-family: var(--font-family-display);
		font-size: 1.2rem;
	}

	input:not([type='checkbox']) {
		width: 100%;
		box-sizing: border-box;
	}

	p {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.8;

		&.error {
			color: var(--color-red);
			opacity: 1;
		}
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
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
		cursor: pointer;

		&:hover {
			background-color: #8882;
		}

		span {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* The app's own checkbox style is made for notes; this list is on the page background. */
		input[type='checkbox'] {
			appearance: auto;
			flex-shrink: 0;
			width: 1rem;
			height: 1rem;
			margin: 0;
			padding: 0;
			border: revert;
			background: revert;
			opacity: 1;
			accent-color: var(--color-yellow);

			&::before {
				content: none;
			}
		}
	}

	.create {
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;

		&:hover {
			background-color: #8882;
		}
	}
</style>

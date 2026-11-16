<script lang="ts">
	import Button from '../components/Button.svelte';
	import { localUser } from '../User.svelte';
	import { db } from '../Database';
	import { REMEMBERED_SESSION_DAYS } from '../auth/Session';
	import { decodeKey } from '../cryptography/PrivateKey';
	import { fileDrop } from '../components/FileDrop';
	import { IMPORT_SOURCES, type ImportSource, type ImportSourceId } from '../import';
	import { importNotes, type ImportProgress, type ImportSummary } from '../import/ImportNotes';
	import { tagHref } from '../tags/TagLinks';
	import { defaultPreferences, preferencesOf, type Preferences } from './Preferences';

	let settings = $state<Preferences>(
		localUser.data ? preferencesOf(localUser.data) : { ...defaultPreferences }
	);
	let hasLoadedInitialSettings = $state(false);

	$effect(() => {
		if (!localUser.isLoading && localUser.data && !hasLoadedInitialSettings) {
			settings = preferencesOf(localUser.data);
			hasLoadedInitialSettings = true;
		}
	});

	let hasChanges = $derived.by(() => {
		if (!localUser.data) return false;
		return JSON.stringify(settings) !== JSON.stringify(preferencesOf(localUser.data));
	});

	async function saveChanges() {
		// The layout applies preferences such as the theme when the user record changes.
		await db.users.update(localUser.data!.id, { preferences: $state.snapshot(settings) });
	}

	// One import at a time, whose progress or outcome is shown with its source.
	let importState = $state<{
		source: ImportSourceId;
		progress?: ImportProgress;
		summary?: ImportSummary;
		error?: string;
	} | null>(null);
	const isImporting = $derived(!!importState && !importState.summary && !importState.error);
	const fileInputs = $state<Partial<Record<ImportSourceId, HTMLInputElement>>>({});

	async function startImport(source: ImportSource, file: File) {
		const user = localUser.data!;
		importState = { source: source.id };
		try {
			const summary = await importNotes(
				source,
				file,
				{ id: user.id, publicKeyUint8: decodeKey(user.publicKey) },
				(progress) => (importState = { source: source.id, progress })
			);
			importState = { source: source.id, summary };
		} catch (error) {
			console.warn('Import failed', error);
			importState = {
				source: source.id,
				error: error instanceof Error ? error.message : 'The notes couldn’t be imported.'
			};
		}
	}

	const notesCount = (count: number) => (count === 1 ? '1 note' : `${count} notes`);
	const MAX_FAILED_NAMES = 3;
</script>

<section>
	{#if localUser.isLoading}
		<p>Loading settings...</p>
	{:else if !localUser.data}
		<p>Please log in to view and edit your settings.</p>
	{:else}
		<div class="saveState">
			{#if hasChanges}
				<Button onclick={saveChanges}>Save Changes</Button>
			{:else}
				<p>All changes saved.</p>
			{/if}
		</div>
		<div class="preferencesList">
			<h2>Preferences</h2>
			<div class="preferenceItem">
				<label for="pref-theme">Theme</label>
				<select id="pref-theme" bind:value={settings.theme}>
					<option value="system">System</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</div>
			<div class="preferenceItem">
				<div>
					<label for="pref-twoColumns">Two notes side by side</label>
					<p>On narrow screens such as phones, show two smaller notes per row instead of one.</p>
				</div>
				<input
					id="pref-twoColumns"
					type="checkbox"
					bind:checked={settings.twoColumnsOnNarrowScreens}
				/>
			</div>
		</div>
		<div class="preferencesList">
			<h2>Security</h2>
			<div class="preferenceItem">
				<div>
					<label for="security-stayLoggedIn">Stay logged in</label>
					<p>
						Stay logged in on this device after closing the app, until you haven't used it for {REMEMBERED_SESSION_DAYS}
						days. Anyone who can use this device can then read your notes, without your password.
					</p>
				</div>
				<input id="security-stayLoggedIn" type="checkbox" bind:checked={settings.stayLoggedIn} />
			</div>
		</div>
		<div class="preferencesList">
			<h2>Import</h2>
			{#each IMPORT_SOURCES as source (source.id)}
				{@const state = importState?.source === source.id ? importState : null}
				<div
					class="preferenceItem"
					{@attach fileDrop((file) => startImport(source, file), !isImporting)}
				>
					<div>
						<label for="import-{source.id}">{source.name}</label>
						<p>{source.description} Imported notes get the tag “{source.tag}”.</p>
						{#if state}
							<p class="importStatus" role="status">
								{#if state.error}
									<span class="error">{state.error}</span>
								{:else if state.summary}
									{@const { imported, archived, trashed, failed } = state.summary}
									Imported {notesCount(imported)}{archived > 0
										? `, of which ${archived} to the archive`
										: ''}.
									{#if imported > 0}
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it -->
										<a href={tagHref(source.tag)}>View them</a>
									{/if}
									{#if trashed > 0}
										Left out {notesCount(trashed)} that {trashed === 1 ? 'was' : 'were'} in the trash.
									{/if}
									{#if failed.length > 0}
										<span class="error">
											{failed.length === 1 ? '1 file' : `${failed.length} files`} couldn’t be read: {failed
												.slice(0, MAX_FAILED_NAMES)
												.join(', ')}{failed.length > MAX_FAILED_NAMES
												? ` and ${failed.length - MAX_FAILED_NAMES} more`
												: ''}.
										</span>
									{/if}
								{:else if state.progress}
									{state.progress.step === 'reading' ? 'Reading' : 'Saving'} notes… {state.progress
										.done} of {state.progress.total}
								{:else}
									Reading the file…
								{/if}
							</p>
						{/if}
					</div>
					<input
						bind:this={fileInputs[source.id]}
						id="import-{source.id}"
						type="file"
						accept={source.accept}
						hidden
						onchange={(event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = '';
							if (file) startImport(source, file);
						}}
					/>
					<Button class="sm" disabled={isImporting} onclick={() => fileInputs[source.id]?.click()}>
						Choose file
					</Button>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: auto;

		/* As high as the button, so the page doesn't shift when it shows up. */
		.saveState {
			display: flex;
			align-items: center;
			height: 2.75rem;
		}

		.preferencesList {
			display: flex;
			flex-direction: column;
			max-width: min(60ch, 100%);
			gap: var(--spacing-sm);

			&:not(:first-child) {
				margin-top: var(--spacing-xxl);
			}

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

				.importStatus {
					margin-top: var(--spacing-sm);
					color: var(--color-text-primary);

					a {
						text-decoration: underline;
					}

					.error {
						color: var(--color-red);
					}
				}

				/* Set by the fileDrop attachment. */
				&:global([data-dropping]) {
					outline: 2px dashed var(--color-yellow);
					outline-offset: -2px;
				}

				/* The global checkbox style is meant for the notes' light colours, and would be hard to see
				   here in the dark theme. These match the dropdown instead. */
				input[type='checkbox'] {
					flex-shrink: 0;
					width: 1.25em;
					height: 1.25em;
					background: var(--color-input-background);
					border: 2px solid rgba(from var(--color-text-primary) r g b / 0.5);
					opacity: 1;

					&:hover {
						border-color: var(--color-text-primary);
					}

					&:checked {
						background: var(--color-text-primary);
						border-color: var(--color-text-primary);

						&::before {
							color: var(--color-input-background);
						}
					}
				}
			}
		}
	}
</style>

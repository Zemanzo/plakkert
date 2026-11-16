<script lang="ts">
	import Button from '../components/Button.svelte';
	import { localUser } from '../User.svelte';
	import { db } from '../Database';
	import { getUnlockedSession, REMEMBERED_SESSION_DAYS } from '../auth/Session';
	import { decodeKey } from '../cryptography/PrivateKey';
	import { fileDrop } from '../components/FileDrop';
	import { IMPORT_SOURCES, type ImportSource, type ImportSourceId } from '../import';
	import { prepareImport, saveImport } from '../import/ImportNotes';
	import type { ImportPlan } from '../import/ImportPlan';
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

	// One import at a time: the file is read first, and what it will import is shown, so the user
	// can confirm it before anything is saved.
	type ImportState = { source: ImportSourceId } & (
		| { step: 'reading'; done: number; total: number }
		| { step: 'confirming'; plan: ImportPlan }
		| { step: 'saving'; plan: ImportPlan; done: number }
		| { step: 'done'; plan: ImportPlan }
		| { step: 'failed'; error: string }
	);
	let importState = $state<ImportState | null>(null);
	const isImporting = $derived(importState?.step === 'reading' || importState?.step === 'saving');
	const fileInputs = $state<Partial<Record<ImportSourceId, HTMLInputElement>>>({});

	const importingUser = () => {
		const user = localUser.data!;
		return {
			id: user.id,
			publicKeyUint8: decodeKey(user.publicKey),
			decodedPrivateKey: getUnlockedSession()!.privateKey
		};
	};

	function showImportError(source: ImportSource, error: unknown) {
		console.warn('Import failed', error);
		importState = {
			source: source.id,
			step: 'failed',
			error: error instanceof Error ? error.message : 'The notes couldn’t be imported.'
		};
	}

	async function readImport(source: ImportSource, file: File) {
		importState = { source: source.id, step: 'reading', done: 0, total: 0 };
		try {
			const plan = await prepareImport(source, file, importingUser(), (done, total) => {
				importState = { source: source.id, step: 'reading', done, total };
			});
			importState = { source: source.id, step: 'confirming', plan };
		} catch (error) {
			showImportError(source, error);
		}
	}

	async function confirmImport(plan: ImportPlan) {
		const source = plan.source.id;
		importState = { source, step: 'saving', plan, done: 0 };
		try {
			await saveImport(plan, importingUser(), (done) => {
				importState = { source, step: 'saving', plan, done };
			});
			importState = { source, step: 'done', plan };
		} catch (error) {
			showImportError(plan.source, error);
		}
	}

	const notesCount = (count: number) => (count === 1 ? '1 note' : `${count} notes`);
	const were = (count: number) => (count === 1 ? 'was' : 'were');
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
					{@attach fileDrop((file) => readImport(source, file), !isImporting)}
				>
					<div>
						<label for="import-{source.id}">{source.name}</label>
						<p>{source.description} Imported notes get the tag “{source.tag}”.</p>
						{#if state}
							<div class="importStatus" aria-live="polite">
								{#if state.step === 'failed'}
									<p class="error">{state.error}</p>
								{:else if state.step === 'reading'}
									<p>
										{state.total > 0
											? `Reading notes… ${state.done} of ${state.total}`
											: 'Reading the file…'}
									</p>
								{:else if state.step === 'saving'}
									<p>Saving notes… {state.done} of {state.plan.notes.length}</p>
								{:else if state.step === 'done'}
									<p>
										Imported {notesCount(state.plan.notes.length)}.
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves it -->
										<a href={tagHref(source.tag)}>View them</a>
									</p>
								{:else}
									{@const { notes, archived, labels, duplicates, trashed, failed } = state.plan}
									<p class="importSummary">
										{notes.length > 0
											? `Ready to import ${notesCount(notes.length)}${archived > 0 ? `, of which ${archived} to the archive` : ''}.`
											: 'There are no new notes to import.'}
									</p>
									{#if labels.length > 0}
										<p>
											{labels.length === 1
												? 'Their label becomes a tag:'
												: `Their ${labels.length} labels become tags:`}
										</p>
										<ul class="importLabels">
											{#each labels as label (label.name)}
												<li title={notesCount(label.notes)}>
													{label.name}
													<span class="count">{label.notes}</span>
													{#if !label.isNewTag}<span class="existing">existing tag</span>{/if}
												</li>
											{/each}
										</ul>
									{/if}
									{#if duplicates > 0}
										<p>
											Skipping {notesCount(duplicates)} that {were(duplicates)} imported before.
										</p>
									{/if}
									{#if trashed > 0}
										<p>Leaving out {notesCount(trashed)} that {were(trashed)} in the trash.</p>
									{/if}
									{#if failed.length > 0}
										<p class="error">
											{failed.length === 1 ? '1 file' : `${failed.length} files`} couldn’t be read: {failed
												.slice(0, MAX_FAILED_NAMES)
												.join(', ')}{failed.length > MAX_FAILED_NAMES
												? ` and ${failed.length - MAX_FAILED_NAMES} more`
												: ''}.
										</p>
									{/if}
									<div class="importActions">
										{#if notes.length > 0}
											<Button class="sm" onclick={() => confirmImport(state.plan)}>
												Import {notesCount(notes.length)}
											</Button>
										{/if}
										<Button
											class="sm"
											--bg="var(--color-input-background)"
											--text="var(--color-text-primary)"
											onclick={() => (importState = null)}
										>
											{notes.length > 0 ? 'Cancel' : 'OK'}
										</Button>
									</div>
								{/if}
							</div>
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
							if (file) readImport(source, file);
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
					display: flex;
					flex-direction: column;
					gap: var(--spacing-sm);
					margin-block: var(--spacing-md) var(--spacing-sm);

					p {
						color: var(--color-text-primary);
					}

					.importSummary {
						font-size: 0.9rem;
						font-weight: 500;
					}

					a {
						text-decoration: underline;
					}

					.error {
						color: var(--color-red);
					}
				}

				.importLabels {
					display: flex;
					flex-wrap: wrap;
					gap: var(--spacing-xs) var(--spacing-sm);
					font-size: 0.8rem;

					li {
						display: flex;
						align-items: center;
						gap: var(--spacing-sm);
						padding: var(--spacing-xs) var(--spacing-md);
						border-radius: 999px;
						background: var(--color-input-background);
					}

					.count,
					.existing {
						color: var(--color-text-muted);
					}
				}

				.importActions {
					display: flex;
					gap: var(--spacing-sm);
					margin-top: var(--spacing-xs);
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

<script lang="ts">
	import Button from '../components/Button.svelte';
	import { localUser } from '../User.svelte';
	import { db } from '../Database';
	import { REMEMBERED_SESSION_DAYS } from '../auth/Session';
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
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;

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

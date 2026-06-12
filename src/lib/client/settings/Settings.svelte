<script lang="ts">
	import Button from '../components/Button.svelte';
	import { localUser } from '../User.svelte';
	import { db } from '../Database';
	import { defaultPreferences, type Preferences } from './Preferences';

	let settings = $state<Preferences>(
		localUser.data?.preferences ? { ...localUser.data.preferences } : defaultPreferences
	);
	let hasLoadedInitialSettings = $state(false);

	$effect(() => {
		if (!localUser.isLoading && localUser.data && !hasLoadedInitialSettings) {
			if (localUser.data.preferences) {
				settings = { ...localUser.data.preferences };
			}
			hasLoadedInitialSettings = true;
		}
	});

	let hasChanges = $derived.by(() => {
		if (!localUser.data) return false;
		return JSON.stringify(settings) !== JSON.stringify(localUser.data.preferences);
	});
</script>

<section>
	{#if localUser.isLoading}
		<p>Loading settings...</p>
	{:else if !localUser.data}
		<p>Please log in to view and edit your settings.</p>
	{:else}
		<div>
			{#if hasChanges}
				<Button
					onclick={async () => {
						await db.users.update(localUser.data!.id, { preferences: $state.snapshot(settings) });
					}}>Save Changes</Button
				>
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
		</div>
		<!-- <div class="preferencesList">
			<h2>Security</h2>
			<div class="preferenceItem">
				<div>
					<label for="security-privateKeyProtection">Keep notes unlocked</label>
					<p>Choose how long your private key is kept in memory after you unlock your notes.</p>
				</div>
				<select id="security-privateKeyProtection">
					<option value="session" selected>Session storage</option>
					<option value="light">Local storage</option>
					<option value="dark"></option>
				</select>
			</div>
		</div> -->
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;

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

				input[type='checkbox'] {
					width: 1.25em;
					height: 1.25em;
				}
			}
		}
	}
</style>

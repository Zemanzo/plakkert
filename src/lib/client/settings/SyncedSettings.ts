import { db } from '../Database';
import { decryptForUser, encryptForUser } from '../serialization/Serialize';
import { syncEngine } from '../sync/Sync.svelte';
import type { RuntimeUser } from '#lib/types.js';

/**
 * The user's settings that sync across their devices, unlike the
 * `Preferences` of a device. They're encrypted with the user's own key.
 */
export interface SyncedSettings {
	/**
	 * The order of the tags, by name, if the user chose one. Tags that aren't
	 * listed come after these, sorted by name.
	 */
	tagOrder: string[];
}

export const defaultSyncedSettings: SyncedSettings = { tagOrder: [] };

type SettingsUser = Pick<RuntimeUser, 'id' | 'publicKeyUint8' | 'decodedPrivateKey'>;

/**
 * Validates settings that were decrypted from storage, keeping the defaults
 * for anything missing or invalid, so a corrupt value can't break the app.
 */
export function parseSyncedSettings(value: unknown): SyncedSettings {
	const settings = { ...defaultSyncedSettings };
	if (typeof value !== 'object' || value === null) return settings;
	const { tagOrder } = value as Record<string, unknown>;
	if (Array.isArray(tagOrder)) {
		settings.tagOrder = tagOrder.filter((tag): tag is string => typeof tag === 'string');
	}
	return settings;
}

/** Decrypts the settings as stored in IndexedDB, or returns the defaults if there are none. */
export async function decryptSyncedSettings(
	content: Uint8Array | undefined,
	user: SettingsUser
): Promise<SyncedSettings> {
	if (!content) return { ...defaultSyncedSettings };
	return parseSyncedSettings(
		await decryptForUser(content, user.publicKeyUint8, user.decodedPrivateKey)
	);
}

/**
 * Changes the user's synced settings. Like notes, this is written to
 * IndexedDB first and synced in the background, so it also works offline.
 */
export async function updateSyncedSettings(
	user: SettingsUser,
	update: (settings: SyncedSettings) => SyncedSettings
) {
	const row = await db.syncedSettings.get(user.id);
	const settings = update(await decryptSyncedSettings(row?.content, user));
	await db.syncedSettings.put({
		userId: user.id,
		content: await encryptForUser(settings, user.publicKeyUint8),
		// Always after the stored version, even if this device's clock is behind, so the change
		// isn't lost to it in last-write-wins.
		updatedAt: new Date(Math.max(Date.now(), (row?.updatedAt.getTime() ?? 0) + 1)),
		dirty: 1
	});
	syncEngine.requestSync();
}

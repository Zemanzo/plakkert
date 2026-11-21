import {
	MAX_FILTER_TAGS,
	parseMcpTagFilter,
	type McpPermissions,
	type McpTagFilter
} from '#lib/mcp.js';
import { decryptForUser, encryptForUser } from '../serialization/Serialize';
import { findExistingTag } from '../tags/Tags';

// What the user lets a connected MCP app do. The tags of an app's filter are encrypted with the
// user's public key here, in the browser, so the server can only read them while the app calls,
// with the user's key from the app's token. See `src/lib/server/mcp/scope.ts`.

/** A connected app, as the settings list it. */
export interface McpClient {
	id: string;
	clientName: string;
	createdAt: string;
	lastUsedAt: string | null;
	permissions: McpPermissions;
	/** Its tag filter, encrypted, as base64. Null for none. */
	tagFilter: string | null;
}

interface Keys {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}

/**
 * Encrypts a filter's tags for the server, or null when there are none. Throws for a filter the
 * server couldn't use, which would leave no note in the app's reach.
 */
export async function sealTagFilter(tags: McpTagFilter, publicKey: Uint8Array) {
	if (tags.length === 0) return null;
	if (!parseMcpTagFilter(tags))
		throw new Error(`A filter can have at most ${MAX_FILTER_TAGS} tags`);
	return (await encryptForUser(tags, publicKey)).toBase64();
}

/** Decrypts an app's filter. Null if it can't be decrypted, or isn't a filter. */
export async function openTagFilter(
	tagFilter: string | null,
	{ publicKey, privateKey }: Keys
): Promise<McpTagFilter | null> {
	if (!tagFilter) return [];
	try {
		const tags = parseMcpTagFilter(
			await decryptForUser(Uint8Array.fromBase64(tagFilter), publicKey, privateKey)
		);
		if (!tags) console.warn('An app’s tag filter isn’t a list of tags');
		return tags;
	} catch (error) {
		console.warn('Could not decrypt an app’s tag filter', error);
		return null;
	}
}

/** Changes what an app may do, from its next request on. */
export async function saveClientAccess(
	clientId: string,
	permissions: McpPermissions,
	tags: McpTagFilter,
	publicKey: Uint8Array
) {
	const response = await fetch(`/api/mcp/clients/${encodeURIComponent(clientId)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ permissions, tagFilter: await sealTagFilter(tags, publicKey) })
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/**
 * A filter's tags after the user renamed tags, or null if none of them was renamed. Filters
 * match tags whatever their case, so renames do too. Deleted tags stay in the filter: taking
 * them out could let an app see more than before, if it was the last tag it was limited to.
 */
export function renamedTagFilter(
	tags: McpTagFilter,
	changes: ReadonlyMap<string, string | null>
): McpTagFilter | null {
	const renames = [...changes].filter((entry): entry is [string, string] => !!entry[1]);
	const renamedTo = (tag: string) => {
		const lowerCase = tag.toLocaleLowerCase();
		return renames.find(([from]) => from.toLocaleLowerCase() === lowerCase)?.[1];
	};
	if (!tags.some((tag) => renamedTo(tag) !== undefined)) return null;
	const renamed: string[] = [];
	for (const tag of tags.map((t) => renamedTo(t) ?? t)) {
		if (findExistingTag(renamed, tag) === undefined) renamed.push(tag);
	}
	return renamed;
}

/**
 * Renames tags in the filters of the user's apps, before they're renamed on their notes, so a
 * filter keeps meaning the same notes. Throws if that can't be done now, e.g. offline: then
 * renaming the tags could let an app see notes it may not, once the rename syncs.
 *
 * Without MCP on the server, there's nothing to change.
 */
export async function renameTagsInMcpFilters(
	changes: ReadonlyMap<string, string | null>,
	keys: Keys
) {
	if (![...changes.values()].some(Boolean)) return;
	const response = await fetch('/api/mcp/access');
	if (response.status === 404) return;
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const { clients } = (await response.json()) as { clients: McpClient[] };
	for (const client of clients) {
		const tags = await openTagFilter(client.tagFilter, keys);
		// Leaves no note in reach of the app as it is (see `scope.ts`), whatever the tags.
		if (!tags) continue;
		const renamed = renamedTagFilter(tags, changes);
		if (renamed) await saveClientAccess(client.id, client.permissions, renamed, keys.publicKey);
	}
}

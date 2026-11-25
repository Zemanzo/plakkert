// Shared by the app and the server, for MCP access to a user's notes. See `src/lib/server/mcp/`.

/** The path of the MCP endpoint. */
export const MCP_PATH = '/mcp';

/**
 * The only scope there is: the user's notes, with whatever permissions the user gave the app (see
 * `McpPermissions`). Scopes can't express those, as the user picks them, not the app.
 */
export const MCP_SCOPE = 'notes';
/** What the scope was called while apps could only read. Still accepted from apps that ask for it. */
export const LEGACY_MCP_SCOPE = 'notes:read';

/**
 * Used to derive the key that encrypts a user's private key for a grant from the grant's secret,
 * so that key is only ever used for this.
 */
export const WRAP_KEY_CONTEXT = 'plakkert mcp grant key v1';

/**
 * What the user lets a connected app do. Everything but creating notes needs `read`, and follows
 * its rules: an app can only change, delete or share notes it can see.
 *
 * The tags that `tagMode` applies to aren't in here: they're encrypted with the user's public key
 * (see `McpTagFilter`), so the server can only read them while the app calls, like the notes.
 */
export interface McpPermissions {
	/** Search and read notes. */
	read: boolean;
	/** Also notes the user hides in the app until opened. */
	readHidden: boolean;
	/** Whether the filter's tags are the only ones it may see notes of, or the ones it may not. */
	tagMode: 'include' | 'exclude';
	/** Make new notes. */
	create: boolean;
	/** Change the text of notes. */
	edit: boolean;
	/** Move notes to the trash, and restore them. */
	delete: boolean;
	/** Tag and untag, change the colour, archive, hide, and undo those. */
	organize: boolean;
	/** Share notes the user owns with other users, and stop sharing them. */
	share: boolean;
	/**
	 * Download backups, and restore them. A backup has all of the user's notes, so this goes past
	 * `read` and its rules, though encrypted: the app can't read it. But it holds the user's
	 * private key, encrypted with their password, which someone could try to guess offline.
	 */
	backup: boolean;
}

/** The tags of a grant's filter, before they're encrypted. Empty for no filter. */
export type McpTagFilter = string[];

/** What the approval page starts with: reading, without hidden notes, and no changes. */
export const DEFAULT_MCP_PERMISSIONS: McpPermissions = {
	read: true,
	readHidden: false,
	tagMode: 'include',
	create: false,
	edit: false,
	delete: false,
	organize: false,
	share: false,
	backup: false
};

/** The permissions that need `read`. */
export const READ_DEPENDENT_PERMISSIONS = ['edit', 'delete', 'organize', 'share'] as const;

/**
 * Checks permissions from a request or the database, and makes them consistent: without `read`,
 * nothing that needs it is allowed. Returns null for anything that isn't permissions.
 */
export function parseMcpPermissions(value: unknown): McpPermissions | null {
	if (typeof value !== 'object' || value === null) return null;
	const input = value as Record<string, unknown>;
	const flags = ['read', 'readHidden', 'create', ...READ_DEPENDENT_PERMISSIONS] as const;
	if (!flags.every((flag) => typeof input[flag] === 'boolean')) return null;
	if (input.tagMode !== 'include' && input.tagMode !== 'exclude') return null;
	// Grants from before backups don't have it, and can't make them.
	if (input.backup !== undefined && typeof input.backup !== 'boolean') return null;
	const read = input.read as boolean;
	return {
		read,
		readHidden: read && (input.readHidden as boolean),
		tagMode: input.tagMode,
		create: input.create as boolean,
		edit: read && (input.edit as boolean),
		delete: read && (input.delete as boolean),
		organize: read && (input.organize as boolean),
		share: read && (input.share as boolean),
		backup: input.backup === true
	};
}

/** The most tags a filter can have, and the most bytes it can take encrypted. */
export const MAX_FILTER_TAGS = 200;
export const MAX_TAG_FILTER_BYTES = 16 * 1024;

/**
 * Checks a decrypted tag filter. Null for anything that isn't one: a list of at most
 * `MAX_FILTER_TAGS` tag names. Never fewer tags than it has, as for an exclude filter that would
 * let the app see more than the user chose.
 */
export function parseMcpTagFilter(value: unknown): McpTagFilter | null {
	if (!Array.isArray(value)) return null;
	if (!value.every((tag) => typeof tag === 'string' && tag.length > 0)) return null;
	const tags = [...new Set(value as string[])];
	return tags.length <= MAX_FILTER_TAGS ? tags : null;
}

import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

export const notes = sqliteTable('notes', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	owner: text('owner')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	// (encrypted) contains title, content, style, category in JSON format
	content: blob('content'),
	// Timestamps are in milliseconds, so last-write-wins sync can tell apart edits within a second.
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	// Non-null value acts as a tombstone marker so deletions can propagate via sync.
	deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
	/** When the server last stored a change to the note, by its own clock (see `changeStamp`), so
	 * clients can ask for only what changed. `updatedAt` is the client's clock, for last-write-wins. */
	changedAt: integer('changed_at').notNull().default(0)
});

export const userNotes = sqliteTable(
	'user_notes',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		noteId: text('note_id')
			.notNull()
			.references(() => notes.id, { onDelete: 'cascade' }),
		/** This is an asymmetric key used to encrypt the note content for this
		 * user, which itself is encrypted with the user's public key. This way,
		 * only the intended user can decrypt the note content. */
		noteKey: text('note_key').notNull(),
		permissions: text('permissions', { enum: ['view', 'edit'] })
			.notNull()
			.default('view'),
		/** The tags this user gave the note, including whether they archived or trashed it,
		 * encrypted with the note key. They are per user, so everyone who has access to a note
		 * organises it their own way. */
		tags: blob('tags'),
		// Tags sync separately from the note content, with their own last-write-wins timestamp.
		tagsUpdatedAt: integer('tags_updated_at', { mode: 'timestamp_ms' }),
		/** Like `notes.changedAt`, for changes to this user's access and tags. */
		changedAt: integer('changed_at').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		// Ensure each user can only have one permission entry per note
		uniqueIndex('user_note_unique').on(table.userId, table.noteId)
	]
);

/** Settings that sync across a user's devices, such as the order of their tags. */
export const userSettings = sqliteTable('user_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** Encrypted with the user's public key, as JSON, so the server can't read the tag names in it. */
	content: blob('content').notNull(),
	/** The client's clock, for last-write-wins, like `notes.updatedAt`. */
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	/** Like `notes.changedAt`. */
	changedAt: integer('changed_at').notNull().default(0)
});

// MCP: AI assistants and other MCP clients reading a user's notes, with their permission. See
// `src/lib/server/mcp/`. Clients sign in with OAuth, with this server as authorization server.

/** Users who allow MCP clients to read their notes. Turning it off removes the row and all grants. */
export const mcpAccess = sqliteTable('mcp_access', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	enabledAt: integer('enabled_at', { mode: 'timestamp_ms' }).notNull()
});

/** OAuth clients, registered by themselves (RFC 7591). Their names aren't verified. */
export const oauthClients = sqliteTable('oauth_clients', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** JSON array of the exact URIs the client may be sent back to. */
	redirectUris: text('redirect_uris').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * A user's permission for a client to read their notes. Holds the user's private key, encrypted
 * with a secret that only the client has: it's part of the client's code and tokens, and never
 * stored here. So the server can only decrypt notes while a client with a valid token asks.
 */
export const oauthGrants = sqliteTable('oauth_grants', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	clientId: text('client_id')
		.notNull()
		.references(() => oauthClients.id, { onDelete: 'cascade' }),
	/** The user's private key, encrypted by their browser with the grant's secret. */
	wrappedKey: blob('wrapped_key', { mode: 'buffer' }).notNull(),
	scope: text('scope').notNull(),
	/**
	 * What the user lets the client do, as JSON (see `McpPermissions` in `src/lib/mcp.ts`). Grants
	 * from before there were permissions keep what they could do then: read everything.
	 */
	permissions: text('permissions')
		.notNull()
		.default(
			'{"read":true,"readHidden":true,"tagMode":"exclude","create":false,"edit":false,"delete":false,"organize":false,"share":false}'
		),
	/**
	 * The tags the permissions' `tagMode` applies to, as JSON encrypted with the user's public key
	 * by their browser, so only the user, and the server while the client calls, can read them.
	 * Null for no filter.
	 */
	tagFilter: blob('tag_filter', { mode: 'buffer' }),
	/** The MCP endpoint the tokens are for (RFC 8707), so they aren't accepted anywhere else. */
	resource: text('resource').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
});

/** Authorization codes: single use, short-lived, and only valid with the PKCE verifier. */
export const oauthCodes = sqliteTable('oauth_codes', {
	id: text('id').primaryKey(),
	grantId: text('grant_id')
		.notNull()
		.references(() => oauthGrants.id, { onDelete: 'cascade' }),
	/** SHA-256 of the code's secret, which the browser put in the code. */
	secretHash: text('secret_hash').notNull(),
	redirectUri: text('redirect_uri').notNull(),
	codeChallenge: text('code_challenge').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	/** When it was exchanged for tokens. Using it again revokes the grant, as it may have leaked. */
	usedAt: integer('used_at', { mode: 'timestamp_ms' })
});

/** Access and refresh tokens. Only a hash is stored, as a token holds the grant's secret. */
export const oauthTokens = sqliteTable('oauth_tokens', {
	id: text('id').primaryKey(),
	grantId: text('grant_id')
		.notNull()
		.references(() => oauthGrants.id, { onDelete: 'cascade' }),
	kind: text('kind', { enum: ['access', 'refresh'] }).notNull(),
	/** SHA-256 of the whole token. */
	tokenHash: text('token_hash').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	/** When a refresh token was exchanged for new tokens. Using it again revokes the grant. */
	usedAt: integer('used_at', { mode: 'timestamp_ms' })
});

export * from './auth.schema';

import { and, count, eq, lt, notExists } from 'drizzle-orm';
import { MCP } from '$app/env/private';
import {
	DEFAULT_MCP_PERMISSIONS,
	MAX_TAG_FILTER_BYTES,
	MCP_SCOPE,
	parseMcpPermissions,
	parseMcpTagFilter,
	type McpPermissions,
	type McpTagFilter
} from '#lib/mcp.js';
import { db } from '../db/index';
import { mcpAccess, oauthClients, oauthCodes, oauthGrants, oauthTokens, user } from '../db/schema';
import {
	forget,
	loadNoteCrypto,
	parseSecretToken,
	randomToken,
	sameHash,
	sha256,
	unwrapPrivateKey
} from './crypto';
import {
	ACCESS_TOKEN_TTL_MS,
	CODE_TTL_MS,
	isPkceChallenge,
	mcpResource,
	parseClientRegistration,
	parseScope,
	pkceMatches,
	REFRESH_TOKEN_TTL_MS,
	redirectUriMatches,
	resourceMatches
} from './rules';
import type { McpScope } from './scope';

// OAuth 2.1 for MCP clients, with this server as the authorization server. A user approves a
// client in the app, whose browser encrypts the user's private key with a new secret. That secret
// is part of the authorization code, and then of every token, but never stored: the database only
// has hashes. So whoever has the database still can't decrypt anything, and every grant can only
// ever reach the notes of the user who approved it.

const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Clients that registered but were never approved are removed, but not more than this many. */
const MAX_CLIENTS = 1000;

type OAuthError = { status: number; body: { error: string; error_description: string } };
const oauthError = (status: number, error: string, description: string): OAuthError => ({
	status,
	body: { error, error_description: description }
});

// --- Whether MCP clients may read a user's notes ---

export function isMcpEnabled(userId: string) {
	return !!db.select().from(mcpAccess).where(eq(mcpAccess.userId, userId)).get();
}

/** Turns MCP access on or off. Turning it off revokes every grant, and so every token. */
export function setMcpEnabled(userId: string, enabled: boolean) {
	db.transaction((tx) => {
		if (enabled) {
			tx.insert(mcpAccess).values({ userId, enabledAt: new Date() }).onConflictDoNothing().run();
		} else {
			tx.delete(mcpAccess).where(eq(mcpAccess.userId, userId)).run();
			tx.delete(oauthGrants).where(eq(oauthGrants.userId, userId)).run();
		}
	});
}

/** Permissions that can't be read allow nothing, rather than everything. */
const NO_PERMISSIONS: McpPermissions = { ...DEFAULT_MCP_PERMISSIONS, read: false };

function storedPermissions(json: string): McpPermissions {
	try {
		return parseMcpPermissions(JSON.parse(json)) ?? NO_PERMISSIONS;
	} catch {
		return NO_PERMISSIONS;
	}
}

/**
 * The clients a user approved, newest first, with what they may do. The tag filter stays
 * encrypted: the user's browser decrypts it.
 */
export function listGrants(userId: string) {
	return db
		.select({
			id: oauthGrants.id,
			clientName: oauthClients.name,
			createdAt: oauthGrants.createdAt,
			lastUsedAt: oauthGrants.lastUsedAt,
			permissions: oauthGrants.permissions,
			tagFilter: oauthGrants.tagFilter
		})
		.from(oauthGrants)
		.innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
		.where(eq(oauthGrants.userId, userId))
		.all()
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		.map((grant) => ({
			...grant,
			permissions: storedPermissions(grant.permissions),
			tagFilter: grant.tagFilter ? grant.tagFilter.toString('base64') : null
		}));
}

export interface GrantAccess {
	permissions: McpPermissions;
	/** The tags of the filter, encrypted by the user's browser with their public key. */
	tagFilter: Buffer | null;
}

/** Checks what the user's browser sent as a grant's permissions and tag filter, or null. */
export function parseGrantAccess(permissions: unknown, tagFilter: unknown): GrantAccess | null {
	const parsed = parseMcpPermissions(permissions);
	if (!parsed) return null;
	if (tagFilter === null || tagFilter === undefined)
		return { permissions: parsed, tagFilter: null };
	if (typeof tagFilter !== 'string') return null;
	const bytes = Buffer.from(tagFilter, 'base64');
	if (bytes.length === 0 || bytes.length > MAX_TAG_FILTER_BYTES) return null;
	return { permissions: parsed, tagFilter: bytes };
}

/**
 * Changes what one of the user's clients may do, from its next request on. Only their own:
 * another user's grant id does nothing.
 */
export function updateGrantAccess(userId: string, grantId: string, access: GrantAccess) {
	const result = db
		.update(oauthGrants)
		.set({ permissions: JSON.stringify(access.permissions), tagFilter: access.tagFilter })
		.where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
		.run();
	return result.changes > 0;
}

/** Revokes one of the user's grants. Only their own: another user's grant id does nothing. */
export function revokeGrant(userId: string, grantId: string) {
	const result = db
		.delete(oauthGrants)
		.where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
		.run();
	return result.changes > 0;
}

// --- Registration (RFC 7591) ---

function removeStale(now = Date.now()) {
	db.transaction((tx) => {
		tx.delete(oauthCodes)
			.where(lt(oauthCodes.expiresAt, new Date(now)))
			.run();
		tx.delete(oauthTokens)
			.where(lt(oauthTokens.expiresAt, new Date(now)))
			.run();
		// Approved, but the code was never exchanged.
		tx.delete(oauthGrants)
			.where(
				and(
					lt(oauthGrants.createdAt, new Date(now - CODE_TTL_MS)),
					notExists(tx.select().from(oauthTokens).where(eq(oauthTokens.grantId, oauthGrants.id))),
					notExists(tx.select().from(oauthCodes).where(eq(oauthCodes.grantId, oauthGrants.id)))
				)
			)
			.run();
		tx.delete(oauthClients)
			.where(
				and(
					lt(oauthClients.createdAt, new Date(now - UNUSED_CLIENT_TTL_MS)),
					notExists(tx.select().from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id)))
				)
			)
			.run();
	});
}

export function registerClient(body: unknown) {
	const parsed = parseClientRegistration(body);
	if (!parsed.ok) return oauthError(400, parsed.error, parsed.description);
	removeStale();
	if ((db.select({ n: count() }).from(oauthClients).get()?.n ?? 0) >= MAX_CLIENTS) {
		return oauthError(503, 'temporarily_unavailable', 'Too many clients; try again later');
	}
	const id = randomToken(16);
	const createdAt = new Date();
	db.insert(oauthClients)
		.values({
			id,
			name: parsed.client.name,
			redirectUris: JSON.stringify(parsed.client.redirectUris),
			createdAt
		})
		.run();
	return {
		status: 201,
		body: {
			client_id: id,
			client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
			client_name: parsed.client.name,
			redirect_uris: parsed.client.redirectUris,
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		}
	};
}

// --- Authorization ---

export interface AuthorizeRequest {
	clientId: string;
	clientName: string;
	redirectUri: string;
	codeChallenge: string;
	scope: string;
	resource: string;
	state: string | null;
}

/**
 * Checks an authorization request, as the client sent it to the app's authorize page. Errors
 * about the client or its redirect URI are shown on that page; the client can't be trusted with
 * them, and an unchecked redirect URI must not be redirected to. Other errors go back to the
 * client, at its redirect URI.
 */
export function checkAuthorizeRequest(
	params: URLSearchParams,
	origin: string
):
	| { ok: true; request: AuthorizeRequest }
	| { ok: false; redirect: false; description: string }
	| {
			ok: false;
			redirect: true;
			redirectUri: string;
			state: string | null;
			error: string;
			description: string;
	  } {
	const clientId = params.get('client_id');
	const redirectUri = params.get('redirect_uri');
	const client = clientId
		? db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get()
		: undefined;
	if (!client) {
		return { ok: false, redirect: false, description: 'This app isn’t registered (any more).' };
	}
	const registered = JSON.parse(client.redirectUris) as string[];
	if (!redirectUri || !redirectUriMatches(registered, redirectUri)) {
		return {
			ok: false,
			redirect: false,
			description: 'This app asked to go back to an address it didn’t register.'
		};
	}

	const state = params.get('state');
	const fail = (error: string, description: string) => ({
		ok: false as const,
		redirect: true as const,
		redirectUri,
		state,
		error,
		description
	});
	if (params.get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'Only the authorization code flow is supported');
	}
	const codeChallenge = params.get('code_challenge');
	if (params.get('code_challenge_method') !== 'S256' || !isPkceChallenge(codeChallenge)) {
		return fail('invalid_request', 'PKCE with S256 is required');
	}
	const scope = parseScope(params.get('scope'));
	if (!scope) return fail('invalid_scope', `Only the ${MCP_SCOPE} scope is available`);
	if (!resourceMatches(params.get('resource'), origin)) {
		return fail('invalid_target', 'Tokens can only be issued for this server’s MCP endpoint');
	}
	return {
		ok: true,
		request: {
			clientId: client.id,
			clientName: client.name,
			redirectUri,
			codeChallenge,
			scope,
			resource: mcpResource(origin),
			state
		}
	};
}

/**
 * Approves a client for the signed-in user, after checking the request again. Replaces an
 * earlier grant for the same client, so reconnecting doesn't pile up grants.
 *
 * @param wrappedKey The user's private key, encrypted by their browser with the grant's secret.
 * @param secretHash SHA-256 of that secret, which the browser puts in the code it gives the client.
 * @param access What the user lets the client do, from `parseGrantAccess`.
 * @returns The code's id, or an error.
 */
export function approve(
	userId: string,
	request: AuthorizeRequest,
	wrappedKey: Uint8Array,
	secretHash: string,
	access: GrantAccess
) {
	if (!isMcpEnabled(userId))
		return { ok: false as const, description: 'MCP access is turned off.' };
	const grantId = randomToken(16);
	const codeId = randomToken(16);
	const now = new Date();
	db.transaction((tx) => {
		tx.delete(oauthGrants)
			.where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, request.clientId)))
			.run();
		tx.insert(oauthGrants)
			.values({
				id: grantId,
				userId,
				clientId: request.clientId,
				wrappedKey: Buffer.from(wrappedKey),
				scope: request.scope,
				permissions: JSON.stringify(access.permissions),
				tagFilter: access.tagFilter,
				resource: request.resource,
				createdAt: now
			})
			.run();
		tx.insert(oauthCodes)
			.values({
				id: codeId,
				grantId,
				secretHash,
				redirectUri: request.redirectUri,
				codeChallenge: request.codeChallenge,
				expiresAt: new Date(now.getTime() + CODE_TTL_MS)
			})
			.run();
	});
	return { ok: true as const, codeId };
}

// --- Tokens ---

function issueTokens(grantId: string, secret: Uint8Array, scope: string) {
	const secretPart = Buffer.from(secret).toString('base64url');
	const now = Date.now();
	const access = `${randomToken(16)}.${secretPart}`;
	const refresh = `${randomToken(16)}.${secretPart}`;
	db.insert(oauthTokens)
		.values([
			{
				id: access.split('.')[0],
				grantId,
				kind: 'access',
				tokenHash: sha256(access),
				expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS)
			},
			{
				id: refresh.split('.')[0],
				grantId,
				kind: 'refresh',
				tokenHash: sha256(refresh),
				expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS)
			}
		])
		.run();
	return {
		status: 200,
		body: {
			access_token: access,
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_TTL_MS / 1000,
			refresh_token: refresh,
			scope
		}
	};
}

const publicKeyOf = (userId: string) => {
	const row = db.select({ publicKey: user.publicKey }).from(user).where(eq(user.id, userId)).get();
	return row && new Uint8Array(Buffer.from(row.publicKey, 'base64'));
};

/** The token endpoint: exchanges a code, or a refresh token, for new tokens. */
export async function exchangeToken(form: URLSearchParams, origin: string) {
	removeStale();
	switch (form.get('grant_type')) {
		case 'authorization_code':
			return exchangeCode(form, origin);
		case 'refresh_token':
			return refresh(form, origin);
		default:
			return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
	}
}

async function exchangeCode(form: URLSearchParams, origin: string) {
	const invalid = oauthError(400, 'invalid_grant', 'The code is invalid, used or expired');
	const code = parseSecretToken(form.get('code') ?? '');
	if (!code) return invalid;

	// Marked as used in the same (synchronous) transaction as it's read, so a code can't be
	// exchanged twice at the same time.
	const found = db.transaction((tx) => {
		const row = tx
			.select({ code: oauthCodes, grant: oauthGrants })
			.from(oauthCodes)
			.innerJoin(oauthGrants, eq(oauthCodes.grantId, oauthGrants.id))
			.where(eq(oauthCodes.id, code.id))
			.get();
		if (
			!row ||
			!sameHash(sha256(Buffer.from(code.secret).toString('base64url')), row.code.secretHash)
		) {
			return null;
		}
		if (row.code.usedAt) {
			// Used before: someone else may have it, so whatever it gave access to is revoked.
			tx.delete(oauthGrants).where(eq(oauthGrants.id, row.grant.id)).run();
			return null;
		}
		tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.id, code.id)).run();
		return row;
	});
	if (!found) return invalid;
	const { code: codeRow, grant } = found;

	if (codeRow.expiresAt.getTime() < Date.now()) return invalid;
	if (form.get('client_id') !== grant.clientId) {
		return oauthError(400, 'invalid_grant', 'The code was issued to another client');
	}
	if (form.get('redirect_uri') !== codeRow.redirectUri) {
		return oauthError(
			400,
			'invalid_grant',
			'The redirect URI differs from the authorization request'
		);
	}
	if (!pkceMatches(form.get('code_verifier'), codeRow.codeChallenge)) {
		return oauthError(400, 'invalid_grant', 'The PKCE code verifier is wrong');
	}
	if (!resourceMatches(form.get('resource'), origin)) {
		return oauthError(
			400,
			'invalid_target',
			'Tokens can only be issued for this server’s MCP endpoint'
		);
	}
	if (!isMcpEnabled(grant.userId)) {
		return oauthError(400, 'invalid_grant', 'MCP access is turned off');
	}

	// Checks the key the browser sent once, now that the secret is known, rather than on every
	// request: a grant that can't decrypt the user's notes is no use.
	const publicKey = publicKeyOf(grant.userId);
	const privateKey =
		publicKey && (await unwrapPrivateKey(grant.wrappedKey, code.secret, publicKey));
	if (!privateKey) {
		db.delete(oauthGrants).where(eq(oauthGrants.id, grant.id)).run();
		return invalid;
	}
	await forget(privateKey);
	return issueTokens(grant.id, code.secret, grant.scope);
}

async function refresh(form: URLSearchParams, origin: string) {
	const invalid = oauthError(400, 'invalid_grant', 'The refresh token is invalid or expired');
	const token = parseSecretToken(form.get('refresh_token') ?? '');
	if (!token) return invalid;
	const hash = sha256(form.get('refresh_token')!);

	const found = db.transaction((tx) => {
		const row = tx
			.select({ token: oauthTokens, grant: oauthGrants })
			.from(oauthTokens)
			.innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
			.where(and(eq(oauthTokens.id, token.id), eq(oauthTokens.kind, 'refresh')))
			.get();
		if (!row || !sameHash(hash, row.token.tokenHash)) return null;
		if (row.token.usedAt) {
			// Refresh tokens are rotated, so one that was used before has leaked (OAuth 2.1).
			tx.delete(oauthGrants).where(eq(oauthGrants.id, row.grant.id)).run();
			return null;
		}
		tx.update(oauthTokens).set({ usedAt: new Date() }).where(eq(oauthTokens.id, token.id)).run();
		return row;
	});
	if (!found) return invalid;
	if (found.token.expiresAt.getTime() < Date.now()) return invalid;
	if (form.get('client_id') !== found.grant.clientId) {
		return oauthError(400, 'invalid_grant', 'The token was issued to another client');
	}
	if (!resourceMatches(form.get('resource'), origin)) {
		return oauthError(
			400,
			'invalid_target',
			'Tokens can only be issued for this server’s MCP endpoint'
		);
	}
	if (!isMcpEnabled(found.grant.userId)) {
		return oauthError(400, 'invalid_grant', 'MCP access is turned off');
	}
	// Access tokens from before stay valid until they expire, like refreshing early does.
	return issueTokens(found.grant.id, token.secret, found.grant.scope);
}

// --- Checking tokens on MCP requests ---

export interface McpCaller {
	userId: string;
	grantId: string;
	publicKey: Uint8Array;
	/** The user's private key, for this request only. Forget it afterward (see `forget`). */
	privateKey: Uint8Array;
	/** Which notes the client may see, and what it may do with them. */
	scope: McpScope;
}

/** How often a grant's "last used" time is updated, at most. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

/**
 * Checks the bearer token of an MCP request: that it's a current access token, for this MCP
 * endpoint, of a grant whose user still allows MCP access. Returns who is calling, with their
 * private key, or null.
 */
export async function authenticate(
	authorization: string | null,
	origin: string
): Promise<McpCaller | null> {
	// Also refused here, not just in hooks.server.ts, while the server doesn't allow MCP.
	if (!MCP) return null;
	const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
	const token = match && parseSecretToken(match[1]);
	if (!token) return null;

	const row = db
		.select({ token: oauthTokens, grant: oauthGrants, publicKey: user.publicKey })
		.from(oauthTokens)
		.innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
		.innerJoin(mcpAccess, eq(mcpAccess.userId, oauthGrants.userId))
		.innerJoin(user, eq(user.id, oauthGrants.userId))
		.where(and(eq(oauthTokens.id, token.id), eq(oauthTokens.kind, 'access')))
		.get();
	if (!row || !sameHash(sha256(match[1]), row.token.tokenHash)) return null;
	if (row.token.expiresAt.getTime() < Date.now()) return null;
	if (row.grant.resource !== mcpResource(origin)) return null;

	const publicKey = new Uint8Array(Buffer.from(row.publicKey, 'base64'));
	const privateKey = await unwrapPrivateKey(row.grant.wrappedKey, token.secret, publicKey);
	if (!privateKey) return null;

	// The tag filter is encrypted for the user, so it can only be read now. One that can't be read
	// leaves no note in reach (see `scope.ts`), as it can't be told what it lets through.
	let tags: McpTagFilter | null = [];
	if (row.grant.tagFilter) {
		try {
			const crypto = await loadNoteCrypto();
			tags = parseMcpTagFilter(
				crypto.openForUser(new Uint8Array(row.grant.tagFilter), publicKey, privateKey)
			);
		} catch {
			tags = null;
		}
	}

	const now = Date.now();
	if (!row.grant.lastUsedAt || now - row.grant.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
		db.update(oauthGrants)
			.set({ lastUsedAt: new Date(now) })
			.where(eq(oauthGrants.id, row.grant.id))
			.run();
	}
	return {
		userId: row.grant.userId,
		grantId: row.grant.id,
		publicKey,
		privateKey,
		scope: { permissions: storedPermissions(row.grant.permissions), tags }
	};
}

import { findExistingTag } from '#lib/client/tags/Tags.js';
import type { McpPermissions, McpTagFilter } from '#lib/mcp.js';

// Which notes a connected app may see, by the permissions the user gave it. Every tool goes
// through this: notes out of reach are left out of every result, as if they weren't there, and
// can't be changed, deleted or shared either.

export interface McpScope {
	permissions: McpPermissions;
	/**
	 * The tags of the filter, decrypted for this request. Null when they couldn't be decrypted:
	 * then no note is in reach, as it can't be told which are.
	 */
	tags: McpTagFilter | null;
}

/** What of a note decides whether it's in reach. Null tags: they couldn't be decrypted. */
export interface ScopedNote {
	tags: string[] | null;
	hidden: boolean | null;
}

const hasFilter = (scope: McpScope) => scope.tags === null || scope.tags.length > 0;

/** Whether the app may see a note: read it, and change it as far as its permissions go. */
export function inScope(scope: McpScope, note: ScopedNote) {
	const { permissions, tags } = scope;
	if (!permissions.read || tags === null) return false;
	// A note whose tags can't be read could be hidden, or have a tag that's left out.
	if (note.tags === null || note.hidden === null) {
		return permissions.readHidden && !hasFilter(scope);
	}
	if (note.hidden && !permissions.readHidden) return false;
	if (tags.length === 0) return true;
	const tagged = note.tags.some((tag) => findExistingTag(tags, tag) !== undefined);
	return permissions.tagMode === 'include' ? tagged : !tagged;
}

/**
 * Why the app can't give a note this tag, or null if it can: tags the user left out are theirs
 * alone. Tags the app may see are up to the app, even if that takes a note out of its reach.
 */
export function tagProblem(scope: McpScope, tag: string) {
	if (!scope.permissions.read || scope.permissions.tagMode !== 'exclude') return null;
	if (scope.tags === null || findExistingTag(scope.tags, tag) !== undefined) {
		return `The tag “${tag}” is one this app may not use.`;
	}
	return null;
}

/** A description of what the app may see, for its instructions. */
export function describeScope(scope: McpScope) {
	const { permissions, tags } = scope;
	if (!permissions.read) return 'This app can’t read notes.';
	const parts = [
		permissions.readHidden
			? 'This app can read the user’s notes, including hidden ones.'
			: 'This app can read the user’s notes, except hidden ones, which it can’t see at all.'
	];
	if (tags === null) parts.push('Its tag filter couldn’t be read, so it can’t see any note now.');
	else if (tags.length > 0 && permissions.tagMode === 'include') {
		parts.push(
			`It only sees notes with at least one of these tags: ${tags.map((t) => `“${t}”`).join(', ')}. A note without any of them is out of its reach, also one it creates or untags.`
		);
	} else if (tags.length > 0) {
		parts.push(
			'The user left notes with some tags out of its reach; it can’t see those, nor give notes those tags.'
		);
	}
	return parts.join(' ');
}

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
	ARCHIVED_TAG,
	serializeNoteUserData,
	findExistingTag,
	HIDDEN_TAG,
	isTrashed,
	normalizeTagName,
	TRASHED_TAG,
	validateTagName,
	withoutTag,
	withTag,
	type NoteTags,
	type NoteUserData
} from '#lib/client/tags/Tags.js';
import { DEFAULT_NOTE_COLOR } from '#lib/client/note/NoteColors.js';
import { db } from '../db/index';
import { user } from '../db/schema';
import {
	listShares,
	removeShare,
	selectUserNotes,
	upsertShare,
	writeNote,
	writeTags,
	type SharePermission,
	type WriteResult
} from '../notes';
import type { NoteCrypto } from './crypto';
import {
	colorId,
	decryptNote,
	noteInScope,
	toMcpNote,
	type DecryptedNote,
	type McpNote,
	type NoteData
} from './notes';
import type { McpCaller } from './oauth';
import { tagProblem } from './scope';

// Changes MCP clients make to the caller's notes, encrypted like the app does, and stored the way
// the app's own changes are (see `writeNote` and `writeTags`), so they sync to the user's devices.
// Every change reads the note again in a transaction, checks it's in the client's reach, and
// writes it there, so nothing can change the note in between. The tools check the permissions.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string) => ({ ok: false as const, message });

/** Thrown inside a transaction, so nothing of a change that failed halfway is stored. */
class WriteFailure extends Error {}

/** Runs a transaction, with a `WriteFailure` in it as the outcome, after rolling it back. */
function transaction<T>(run: (tx: Transaction) => Outcome<T>): Outcome<T> {
	try {
		return db.transaction(run);
	} catch (error) {
		if (error instanceof WriteFailure) return fail(error.message);
		throw error;
	}
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A time for a change that's later than the stored one, even if the client's clock is ahead. */
const after = (stored: Date | null | undefined) =>
	Math.max(Date.now(), (stored?.getTime() ?? 0) + 1);

function writeProblem(result: WriteResult) {
	switch (result.status) {
		case 200:
			return null;
		case 403:
			return 'The note was shared with the user to view only, so its text and colour can’t be changed.';
		case 410:
			return 'The note was deleted.';
		case 409:
			return 'The note changed at the same time. Read it again and retry.';
		default:
			return 'message' in result ? result.message : 'The note couldn’t be saved.';
	}
}

/** A note as the tools show it after a change, and whether the client can still see it. */
export interface Changed {
	note: McpNote;
	inScope: boolean;
}

/**
 * Checks tag names from the client, like the app does. Names that only differ in case from one
 * the user already has become that one, so "work" goes on as "Work".
 */
export function parseTagNames(
	caller: McpCaller,
	names: string[],
	existing: Iterable<string>
): Outcome<string[]> {
	const tags: string[] = [];
	for (const name of names) {
		const normalized = normalizeTagName(name);
		const problem = validateTagName(normalized) ?? tagProblem(caller.scope, normalized);
		if (problem) return fail(problem);
		const tag = findExistingTag([...tags, ...existing], normalized) ?? normalized;
		if (!tags.includes(tag)) tags.push(tag);
	}
	return { ok: true, value: tags };
}

/**
 * Reads one of the caller's notes in a transaction, if the client may see it. Notes out of its
 * reach are reported like notes that aren't there, so it can't tell them apart.
 */
function readInScope(
	tx: Transaction,
	crypto: NoteCrypto,
	caller: McpCaller,
	id: string
): Outcome<DecryptedNote> {
	const [row] = selectUserNotes(caller.userId, id, tx).all();
	const note = row && decryptNote(crypto, caller, row);
	if (!note || !noteInScope(caller.scope, note)) {
		if (note) crypto.forget(note.noteKey);
		return fail(`There's no note with id ${id}.`);
	}
	return { ok: true, value: note };
}

/** Encrypts and stores a note's new text or colour, and the user's new tags, as the app would. */
function store(
	tx: Transaction,
	crypto: NoteCrypto,
	caller: McpCaller,
	note: DecryptedNote,
	changes: { data?: NoteData; userData?: NoteUserData }
): Outcome<Changed> {
	const { row, noteKey } = note;
	if (changes.data) {
		const result = writeNote(tx, caller.userId, row.id, {
			content: base64(crypto.encryptJson(changes.data, noteKey)),
			updatedAt: after(row.updatedAt)
		});
		const problem = writeProblem(result);
		if (problem) throw new WriteFailure(problem);
	}
	if (changes.userData) {
		const result = writeTags(tx, caller.userId, row.id, {
			tags: base64(crypto.encryptJson(serializeNoteUserData(changes.userData), noteKey)),
			updatedAt: after(row.tagsUpdatedAt)
		});
		const problem = writeProblem(result);
		if (problem) throw new WriteFailure(problem);
	}
	const [stored] = selectUserNotes(caller.userId, row.id, tx).all();
	const updated = decryptNote(crypto, caller, stored)!;
	crypto.forget(updated.noteKey);
	return {
		ok: true,
		value: { note: toMcpNote(caller, updated), inScope: noteInScope(caller.scope, updated) }
	};
}

/**
 * Runs a change to one note in a transaction: reads it, if it's in reach, and stores what the
 * change returns, or its error.
 */
function change(
	crypto: NoteCrypto,
	caller: McpCaller,
	id: string,
	apply: (note: DecryptedNote) => Outcome<{ data?: NoteData; userData?: NoteUserData }>
): Outcome<Changed> {
	return transaction((tx) => {
		const found = readInScope(tx, crypto, caller, id);
		if (!found.ok) return found;
		try {
			const changes = apply(found.value);
			if (!changes.ok) return changes;
			return store(tx, crypto, caller, found.value, changes.value);
		} finally {
			crypto.forget(found.value.noteKey);
		}
	});
}

/** The user's tags of a note, or a failure when they couldn't be decrypted. */
function userDataOf(note: DecryptedNote): Outcome<NoteUserData> {
	return note.userData
		? { ok: true, value: note.userData }
		: fail('The note’s tags couldn’t be decrypted, so they can’t be changed.');
}

function notInTrash(note: DecryptedNote): Outcome<null> {
	return note.userData && isTrashed(note.userData.tags)
		? fail('The note is in the trash. Restore it first.')
		: { ok: true, value: null };
}

export interface NewNote {
	html: string;
	/** As the app names it. */
	color?: string;
	/** Checked with `parseTagNames`. */
	tags: string[];
	archived: boolean;
}

/** Creates a note for the caller, like the app does: with a new key, sealed to the user. */
export function createNote(
	crypto: NoteCrypto,
	caller: McpCaller,
	input: NewNote
): Outcome<Changed> {
	const id = randomUUID();
	const noteKey = crypto.newNoteKey();
	const now = Date.now();
	const data: NoteData = {
		content: input.html,
		meta: { color: (input.color && colorId(input.color)) ?? DEFAULT_NOTE_COLOR }
	};
	let tags: NoteTags = {};
	for (const tag of input.tags) tags = withTag(tags, tag, now);
	if (input.archived) tags = withTag(tags, ARCHIVED_TAG, now);

	try {
		return transaction((tx) => {
			const created = writeNote(tx, caller.userId, id, {
				content: base64(crypto.encryptJson(data, noteKey)),
				noteKey: base64(crypto.sealNoteKey(noteKey, caller.publicKey)),
				createdAt: now,
				updatedAt: now
			});
			const problem = writeProblem(created);
			if (problem) throw new WriteFailure(problem);
			if (Object.keys(tags).length > 0) {
				const tagged = writeTags(tx, caller.userId, id, {
					tags: base64(crypto.encryptJson(tags, noteKey)),
					updatedAt: now
				});
				const taggingProblem = writeProblem(tagged);
				if (taggingProblem) throw new WriteFailure(taggingProblem);
			}
			const [row] = selectUserNotes(caller.userId, id, tx).all();
			const note = decryptNote(crypto, caller, row)!;
			crypto.forget(note.noteKey);
			return {
				ok: true,
				value: { note: toMcpNote(caller, note), inScope: noteInScope(caller.scope, note) }
			};
		});
	} finally {
		crypto.forget(noteKey);
	}
}

/**
 * The most a note's HTML can grow to by adding to its end, so an app can't keep making it larger,
 * for every device to sync. Ten times what one change may add.
 */
export const MAX_APPENDED_NOTE_LENGTH = 1_000_000;

/** Replaces the text of a note, or adds to its end. */
export function editNote(
	crypto: NoteCrypto,
	caller: McpCaller,
	id: string,
	html: string,
	append: boolean
) {
	return change(crypto, caller, id, (note) => {
		if (note.row.permissions !== 'edit') {
			return fail('The note was shared with the user to view only, so its text can’t be changed.');
		}
		const trash = notInTrash(note);
		if (!trash.ok) return trash;
		const before = typeof note.data.content === 'string' ? note.data.content : '';
		const content = append ? before + html : html;
		if (append && content.length > MAX_APPENDED_NOTE_LENGTH) {
			return fail(
				'The note is too long to add more to. Start a new note, or replace this one’s text with a shorter one.'
			);
		}
		return { ok: true, value: { data: { ...note.data, content } } };
	});
}

/** Moves a note to the user's trash, or takes it out again. The trash is the user's own. */
export function setTrashed(crypto: NoteCrypto, caller: McpCaller, id: string, trashed: boolean) {
	return change(crypto, caller, id, (note) => {
		const userData = userDataOf(note);
		if (!userData.ok) return userData;
		const { tags } = userData.value;
		if (isTrashed(tags) === trashed) {
			return fail(trashed ? 'The note is in the trash already.' : 'The note isn’t in the trash.');
		}
		return {
			ok: true,
			value: {
				userData: {
					...userData.value,
					tags: trashed ? withTag(tags, TRASHED_TAG) : withoutTag(tags, TRASHED_TAG)
				}
			}
		};
	});
}

export interface Organizing {
	/** Checked with `parseTagNames`. */
	addTags: string[];
	removeTags: string[];
	/** As the app names it. */
	color?: string;
	archived?: boolean;
	hidden?: boolean;
}

/** Tags and untags a note, changes its colour, and archives or hides it, or undoes that. */
export function organizeNote(crypto: NoteCrypto, caller: McpCaller, id: string, input: Organizing) {
	return change(crypto, caller, id, (note) => {
		const userData = userDataOf(note);
		if (!userData.ok) return userData;
		const trash = notInTrash(note);
		if (!trash.ok) return trash;

		let { tags } = userData.value;
		for (const name of input.removeTags) {
			const tag = findExistingTag(Object.keys(tags), normalizeTagName(name));
			if (tag && !tag.startsWith('$')) tags = withoutTag(tags, tag);
		}
		for (const tag of input.addTags) tags = withTag(tags, tag);
		if (input.archived !== undefined) {
			tags = input.archived ? withTag(tags, ARCHIVED_TAG) : withoutTag(tags, ARCHIVED_TAG);
		}
		if (input.hidden !== undefined) {
			tags = input.hidden ? withTag(tags, HIDDEN_TAG) : withoutTag(tags, HIDDEN_TAG);
		}

		let data: NoteData | undefined;
		if (input.color !== undefined) {
			if (note.row.permissions !== 'edit') {
				return fail(
					'The note was shared with the user to view only, so its colour can’t be changed.'
				);
			}
			data = { ...note.data, meta: { ...note.data.meta, color: colorId(input.color) } };
		}
		// Only tags that changed are stored, as storing them makes them newer than what other
		// devices have yet to sync, which would then lose their changes.
		const userDataChanged = tags !== userData.value.tags;
		return {
			ok: true,
			value: { data, userData: userDataChanged ? { ...userData.value, tags } : undefined }
		};
	});
}

export interface Share {
	username: string;
	permission: SharePermission;
}

/** Reads a note the user owns, in reach of the client, to share it or see who has it. */
function ownedInScope(tx: Transaction, crypto: NoteCrypto, caller: McpCaller, id: string) {
	const found = readInScope(tx, crypto, caller, id);
	if (!found.ok) return found;
	if (found.value.row.owner !== caller.userId) {
		crypto.forget(found.value.noteKey);
		return fail('Only the note’s owner can see or change who it’s shared with.');
	}
	return found;
}

const sharesOf = (id: string, caller: McpCaller, tx: Transaction): Share[] =>
	listShares(id, caller.userId, tx).map((share) => ({
		username: share.username,
		permission: share.permissions
	}));

/** Who one of the user's notes is shared with. */
export function noteShares(crypto: NoteCrypto, caller: McpCaller, id: string): Outcome<Share[]> {
	return transaction((tx) => {
		const found = ownedInScope(tx, crypto, caller, id);
		if (!found.ok) return found;
		crypto.forget(found.value.noteKey);
		return { ok: true, value: sharesOf(id, caller, tx) };
	});
}

const findUser = (tx: Transaction, username: string) =>
	tx
		.select({ id: user.id, username: user.username, publicKey: user.publicKey })
		.from(user)
		.where(eq(user.username, username.trim().toLowerCase()))
		.get();

/**
 * Shares one of the user's notes with another user, or changes what they may do with it. Like
 * the app, the note key is sealed to their public key, so only they can decrypt it.
 */
export function shareNote(
	crypto: NoteCrypto,
	caller: McpCaller,
	id: string,
	{ username, permission }: Share
): Outcome<Share[]> {
	return transaction((tx) => {
		const found = ownedInScope(tx, crypto, caller, id);
		if (!found.ok) return found;
		const { noteKey } = found.value;
		try {
			if (found.value.userData && isTrashed(found.value.userData.tags)) {
				return fail('The note is in the trash. Restore it first.');
			}
			const recipient = findUser(tx, username);
			if (!recipient) return fail(`There's no user called “${username.trim()}”.`);
			if (recipient.id === caller.userId) return fail('The user owns this note already.');
			const sealed = crypto.sealNoteKey(
				noteKey,
				new Uint8Array(Buffer.from(recipient.publicKey, 'base64'))
			);
			upsertShare(tx, id, recipient.id, base64(sealed), permission);
			return { ok: true, value: sharesOf(id, caller, tx) };
		} finally {
			crypto.forget(noteKey);
		}
	});
}

/** Stops sharing one of the user's notes with another user. */
export function unshareNote(
	crypto: NoteCrypto,
	caller: McpCaller,
	id: string,
	username: string
): Outcome<Share[]> {
	return transaction((tx) => {
		const found = ownedInScope(tx, crypto, caller, id);
		if (!found.ok) return found;
		crypto.forget(found.value.noteKey);
		const recipient = findUser(tx, username);
		if (!recipient || recipient.id === caller.userId || !removeShare(tx, id, recipient.id)) {
			return fail(`The note isn’t shared with “${username.trim()}”.`);
		}
		return { ok: true, value: sharesOf(id, caller, tx) };
	});
}

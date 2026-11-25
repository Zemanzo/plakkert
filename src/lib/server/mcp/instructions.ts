import type { McpPermissions } from '#lib/mcp.js';
import { MCP_COLORS } from './notes';

// What the MCP server tells a client about the user's notes, when it connects. Only about the
// tools it has: a client that may only create notes can't search them.

export function instructions(permissions: McpPermissions, scope: string) {
	const { read } = permissions;
	const can = [
		read && 'search and read notes',
		permissions.create && 'create notes',
		permissions.edit && 'change the text of notes',
		permissions.delete && 'move notes to the trash and restore them',
		permissions.organize && 'tag and untag notes, change their colour, and archive or hide them',
		permissions.share && 'share the user’s own notes with other users',
		permissions.backup && 'download and restore backups of all of the user’s notes'
	].filter(Boolean);
	const cannot = [
		!permissions.create && 'create notes',
		!permissions.edit && 'change their text',
		!permissions.delete && 'delete them',
		!permissions.organize && 'tag, archive or hide them',
		!permissions.share && 'share them'
	].filter(Boolean);

	const about = [
		`Each note has a colour (${MCP_COLORS.join(', ')}), which users often use to group notes, e.g. red for grocery lists.` +
			(read ? ' search_notes can filter on it; list_colors shows which colours are used.' : ''),
		`Tags are the user's own labels${read ? '; list_tags lists them' : ''}. A note can have several.`,
		read &&
			'Archived notes are put away by the user but kept; search_notes includes them unless include_archived is false.',
		read &&
			'Trashed notes are deleted forever 30 days after the user trashed them; search_notes leaves them out unless include_trashed is true.',
		read &&
			'Hidden notes are ones the user hides in the app until opened, to keep them from people looking along. Be discreet with them.',
		read &&
			`Notes shared with the user by someone else have shared_by set. Only the owner can share a note; a note shared to view only can't have its text or colour changed.`,
		read &&
			`Only what has synced to the server is here: changes made on a device that hasn't synced yet are missing. Notes imported from Google Keep keep their dates from Keep.`,
		read &&
			`A note that couldn't be decrypted is left out of every result; each result says how many with "skipped".`,
		(permissions.create || permissions.edit) &&
			`Notes are written as Markdown: headings, paragraphs, lists, checklists (- [ ] and - [x]), quotes, code, links, bold, italic and strikethrough. Each line is a paragraph of its own.` +
				(permissions.edit
					? ` Other formatting the app has, such as underlining, is lost when you replace a note's text.`
					: ''),
		permissions.backup &&
			`Backups (export_backup, start_backup_import and restore_backup) hold all of the user's own notes, also ones out of your reach otherwise, but still encrypted: you can't read them. They move as zip files through links, which you download from and upload to with your own tools, such as curl.`
	].filter(Boolean);

	const intro = `The user's notes in Plakkert, an end-to-end encrypted notes app. The user chose what you may do: ${can.length > 0 ? can.join('; ') : 'nothing'}.${cannot.length > 0 ? ` You can't ${cannot.join(', ')}.` : ''} ${scope}`;
	const lines = [intro, '', 'About the notes:', ...about.map((line) => `- ${line}`)];
	if (read) {
		lines.push(
			'',
			'Use search_notes to find notes (it returns summaries), then get_note for a whole note.'
		);
	}
	return lines.join('\n');
}

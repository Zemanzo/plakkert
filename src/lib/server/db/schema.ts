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
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
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
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		// Ensure each user can only have one permission entry per note
		uniqueIndex('user_note_unique').on(table.userId, table.noteId),
	],
);

export * from './auth.schema';

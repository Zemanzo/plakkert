import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

export const notes = sqliteTable('notes', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	user: text('user_id').references(() => user.id).notNull(),
	title: text('title'),
	content: text('content'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	archived: integer('archived').notNull().$default(() => 0),
	style: text('style')
});

export * from './auth.schema';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Make sure /data (or any parent dir) exists before opening sqlite file.
if (!DATABASE_URL.startsWith(':memory:')) {
	mkdirSync(dirname(DATABASE_URL), { recursive: true });
}

const client = new Database(DATABASE_URL);

export const db = drizzle(client, { schema });

// Apply SQL migrations on boot so a fresh database is ready automatically.
migrate(db, { migrationsFolder: 'drizzle' });

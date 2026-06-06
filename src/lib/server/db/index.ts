import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Make sure /data (or any parent dir) exists before opening sqlite file.
if (!env.DATABASE_URL.startsWith(':memory:')) {
	mkdirSync(dirname(env.DATABASE_URL), { recursive: true });
}

const client = new Database(env.DATABASE_URL);

export const db = drizzle(client, { schema });

// Apply SQL migrations on boot so a fresh database is ready automatically.
migrate(db, { migrationsFolder: 'drizzle' });

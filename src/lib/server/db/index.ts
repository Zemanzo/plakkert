import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { building } from '$app/env';
import { DATABASE_URL } from '$app/env/private';

// The build imports server modules (e.g. to prerender pages); don't touch the real database then.
const databaseUrl = building ? ':memory:' : DATABASE_URL;

// Make sure /data (or any parent dir) exists before opening sqlite file.
if (!databaseUrl.startsWith(':memory:')) {
	mkdirSync(dirname(databaseUrl), { recursive: true });
}

const client = new Database(databaseUrl);

export const db = drizzle(client, { schema });

// Apply SQL migrations on boot so a fresh database is ready automatically.
migrate(db, { migrationsFolder: 'drizzle' });

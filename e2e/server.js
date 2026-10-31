// Builds the app and serves the production build on a throwaway database, for the end-to-end
// tests. Started by playwright.config.ts. Set E2E_SKIP_BUILD=1 to serve the existing build.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run from the project root, wherever this is started from.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const port = process.env.PORT ?? '4173';
const dataDir = 'e2e/.data';

Object.assign(process.env, {
	// Read at build time (CSRF checks) and at runtime (Better Auth), like in production.
	ORIGIN: `http://localhost:${port}`,
	DATABASE_URL: `${dataDir}/test.db`,
	BETTER_AUTH_SECRET: 'e2e-test-secret-0123456789abcdefghij',
	PORT: port,
	HOST: '127.0.0.1'
});

rmSync(dataDir, { recursive: true, force: true });

if (!process.env.E2E_SKIP_BUILD) {
	// Through a shell, so pnpm is found on Windows too.
	const result = spawnSync('pnpm build', { stdio: 'inherit', shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// adapter-node's server starts listening when imported. (Imported by URL, so type-checking the
// tests doesn't type-check the build output too.)
await import(new URL('../build/index.js', import.meta.url).href);

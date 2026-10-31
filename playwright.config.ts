import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/helpers';

// End-to-end tests run against the production build, since only that has the service worker
// that makes the app work offline. `pnpm test:e2e` builds it and serves it on a fresh database.
export default defineConfig({
	testDir: 'e2e',
	// Most tests are a story across several devices and users, with real key derivation.
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: true,
	workers: process.env.CI ? 1 : 2,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure'
	},
	projects: [
		{ name: 'chromium', use: devices['Desktop Chrome'] },
		// Only for what browsers are known to disagree on: layout and dragging.
		{
			name: 'firefox',
			use: devices['Desktop Firefox'],
			testMatch: ['popovers.test.ts', 'reorder.test.ts']
		}
	],
	webServer: {
		command: 'node e2e/server.js',
		url: `${BASE_URL}/login`,
		// Building takes a while.
		timeout: 300_000,
		reuseExistingServer: !process.env.CI,
		stdout: 'pipe'
	}
});

import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const CACHE_NAME = `cache-${version}`;
// Manifest paths are relative to the base path; resolve them against the worker's scope.
const toPathname = ({ path }: { path: string }) => new URL(path, self.registration.scope).pathname;
const PAGES = prerendered.map(toPathname);
const ASSETS = [...immutable.map(toPathname), ...assets.map(toPathname), ...PAGES];

// 1. Install event: Cache the app shell (all pages are prerendered), build artifacts and static
// files, so the app works without a connection.
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS))
			// Use the new version on the next page load, rather than once every tab is closed.
			.then(() => self.skipWaiting())
	);
});

// 2. Activate event: Clean up old caches when a new version deploys
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) await caches.delete(key);
			}
		})
	);
});

// 3. Fetch event: Serve the app from the cache, fall back to the network
self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Data and auth requests always go to the network; the app handles being offline itself.
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			if (request.mode === 'navigate') {
				// Every page is the same client-rendered shell, so any cached page can render any route.
				const page = PAGES.includes(url.pathname) ? url.pathname : '/';
				const cachedPage = await cache.match(page);
				if (cachedPage) return cachedPage;
			} else {
				const cachedResponse = await cache.match(request);
				if (cachedResponse) return cachedResponse;
			}

			try {
				return await fetch(request);
			} catch {
				return Response.error();
			}
		})()
	);
});

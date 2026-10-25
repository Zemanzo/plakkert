import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const CACHE_NAME = `cache-${version}`;
// Manifest paths are relative to the base path; resolve them against the worker's scope.
const ASSETS = [...immutable, ...assets, ...prerendered].map(
	({ path }) => new URL(path, self.registration.scope).pathname
);

// 1. Install event: Cache all build artifacts and static files
self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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

// 3. Fetch event: Serve assets from cache first, fall back to network
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) return cachedResponse;

			return fetch(event.request).catch(async () => {
				// If both cache and network fail (e.g., navigating to a new page offline),
				// return the cached root page as a fallback.
				return (await caches.match('/')) ?? Response.error();
			});
		})
	);
});

/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE_NAME = `cache-${version}`;
const ASSETS = [...build, ...files];

// 1. Install event: Cache all build artifacts and static files
self.addEventListener('install', (event: any) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// 2. Activate event: Clean up old caches when a new version deploys
self.addEventListener('activate', (event: any) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) await caches.delete(key);
			}
		})
	);
});

// 3. Fetch event: Serve assets from cache first, fall back to network
self.addEventListener('fetch', (event: any) => {
	if (event.request.method !== 'GET') return;

	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) return cachedResponse;

			return fetch(event.request).catch(() => {
				// If both cache and network fail (e.g., navigating to a new page offline),
				// return the cached root page as a fallback.
				return caches.match('/');
			}) as Promise<Response>;
		})
	);
});

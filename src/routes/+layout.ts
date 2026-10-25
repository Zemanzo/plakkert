// The app is a client-rendered shell that is prerendered at build time, so the service worker
// can cache every page and serve it while offline. All data comes from IndexedDB and `/api`.
export const prerender = true;
export const ssr = false;

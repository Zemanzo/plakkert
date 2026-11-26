# Development

```sh
pnpm install
cp .env.example .env # then fill in the values
pnpm dev
```

- `pnpm check` type-checks the app and the service worker
- `pnpm lint` checks formatting and lints
- `pnpm test` runs the unit tests, on an in-memory database (see `.env.test`)
- `pnpm test:e2e` runs the end-to-end tests in `e2e/` with Playwright. It builds the app and serves
  it on port 4173 (or `PORT`) with a throwaway database. If a server is already running on that
  port, it is used instead, so stop it after changing the code (or set `E2E_SKIP_BUILD=1` to serve
  the existing build). The first time, install the browsers with
  `pnpm exec playwright install chromium firefox`.
- `E2E_PERF=1 pnpm test:e2e perf --project chromium` measures how the app copes with 1000 notes:
  load and sync times, long tasks while typing, searching and selecting, and memory use. It isn't
  a pass/fail test, so it only runs when asked.
- `pnpm db:generate` creates a migration after changing `src/lib/server/db/schema.ts`. Migrations
  are applied automatically when the server starts.

Pages are prerendered as a client-rendered shell, so the service worker only caches real pages in
a production build (`pnpm build`, then `node build`).

GitHub Actions runs the type checks, lint, unit tests and end-to-end tests on every push and pull
request; see `.github/workflows/ci.yml`.

## Dependencies

Only packages the server has to load from `node_modules` at runtime go in `dependencies`: so far
only `better-sqlite3`, which has a native part. Everything else goes in `devDependencies`, also
what the app uses at runtime: adapter-node bundles those into the build, so the production image,
which installs only `dependencies`, doesn't contain them, nor the parts of them the app doesn't
use.

## Adding an importer

Importing from other apps than Google Keep can be added in `src/lib/client/import/`.

# Plakkert

![Plakkert logo](static/icon.svg)

A true end-to-end encrypted notes web app, built for offline-first.

## Current features

- End-to-end encryption
- Works offline
  - The app is cached by a service worker, and notes are stored in IndexedDB
  - Notes can be created, edited and deleted offline, and sync once back online
  - Accounts that have been used on a device before can be unlocked offline
- Sync across devices (last write wins; deletions win over edits)
- Basic input
  - Plain text
  - Bold
  - Italics
  - Inline code
  - Code block
  - Checkbox list block
- Authentication server

## How encryption works

- Every user has a key pair. The private key is encrypted with a key derived from the password
  (PBKDF2, 600k iterations, random salt) before it is sent to the server.
- The password itself is never sent to the server. Instead, the client derives a separate auth key
  from it (PBKDF2 with the username as salt), which the server uses as the account password.
- Every note has its own key, which is encrypted with the owner's public key. Note contents are
  encrypted with that note key, so the server only ever stores ciphertext.

## Development

```sh
pnpm install
cp .env.example .env # then fill in the values
pnpm dev
```

- `pnpm check` type-checks the app and the service worker
- `pnpm lint` checks formatting and lints
- `pnpm test` runs the unit tests
- `pnpm db:generate` creates a migration after changing `src/lib/server/db/schema.ts`. Migrations are
  applied automatically when the server starts.

Pages are prerendered as a client-rendered shell, so the service worker only caches real pages in a
production build (`pnpm build`, then `node build`).

## Planned features

Check the [issues](https://github.com/Zemanzo/plakkert/issues) tab!

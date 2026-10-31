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
- Sharing notes with other users, who can view or edit them
  - Only the owner can share, change permissions or stop sharing; recipients can remove a shared
    note from their own notes
  - Changing who a note is shared with needs a connection; editing shared notes works offline
- Organising notes
  - Tags, to find notes back quickly; tags can be renamed and deleted for all notes at once
  - Archive, for notes you want to keep but not see
  - Trash: notes in the trash are deleted forever after 30 days, or earlier by hand
  - Your own order: drag notes around, or on a touch screen hold a note and then drag it. With the
    keyboard, Shift and the arrow keys move the selected note. The archive and the trash are in the
    order notes ended up there.
  - Tags, archive, trash and order are per user: on a shared note, everyone organises it their own
    way, and only deleting it forever from the trash deletes it for everyone
- Search through the text and tags of notes (`/` jumps to the search field)
- Ten note colours
- Basic input
  - Plain text
  - Bold
  - Italics
  - Inline code
  - Code block
  - Checkbox list block
- Authentication server
- Invite-only registration (see below)

## How encryption works

- Every user has a key pair. The private key is encrypted with a key derived from the password
  (PBKDF2, 600k iterations, random salt) before it is sent to the server.
- The password itself is never sent to the server. Instead, the client derives a separate auth key
  from it (PBKDF2 with the username as salt), which the server uses as the account password.
- Every note has its own key, which is encrypted with the owner's public key. Note contents are
  encrypted with that note key, so the server only ever stores ciphertext.
- Tags are encrypted with the note key as well, and stored per user. Archiving and trashing a note
  are special tags, so the server can't tell either, and so is a note's place in the user's order. Because of that, the server can't empty the
  trash itself: the app deletes notes that have been in the trash for 30 days, once it has synced,
  so a note that was restored on another device isn't deleted by mistake.
- Searching happens in the browser, on the decrypted notes, so it also works offline.
- Sharing a note encrypts its note key with the recipient's public key, so the server never sees it.
  The recipient's public key is fetched from the server and not verified, so this relies on the
  server handing out the right key. Stopping sharing does not change the note key, so someone who
  had access could still decrypt the note if they got hold of its ciphertext later.

## Registration

Who can create an account is set with the `REGISTRATION` environment variable, read when the
server starts:

- `invite` (the default): only people with the invite code in `INVITE_CODE`. Without an invite
  code, nobody can register. Share an invite as a link: `https://<your domain>/register?invite=<code>`.
- `open`: anyone.
- `closed`: nobody.

The server enforces this on the sign-up endpoint itself, and rate limits sign-up attempts. Changing
the invite code stops old invites from working; existing accounts are not affected.

## Development

```sh
pnpm install
cp .env.example .env # then fill in the values
pnpm dev
```

- `pnpm check` type-checks the app and the service worker
- `pnpm lint` checks formatting and lints
- `pnpm test` runs the unit tests
- `pnpm test:e2e` runs the end-to-end tests in `e2e/` with Playwright. It builds the app and serves
  it on port 4173 with a throwaway database. If a server is already running on that port, it is
  used instead, so stop it after changing the code (or set `E2E_SKIP_BUILD=1` to serve the
  existing build). The first time, install the browsers with `pnpm exec playwright install chromium firefox`.
- `pnpm db:generate` creates a migration after changing `src/lib/server/db/schema.ts`. Migrations are
  applied automatically when the server starts.

Pages are prerendered as a client-rendered shell, so the service worker only caches real pages in a
production build (`pnpm build`, then `node build`).

## Planned features

Check the [issues](https://github.com/Zemanzo/plakkert/issues) tab!

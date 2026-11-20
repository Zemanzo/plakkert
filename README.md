![Plakkert logo](static/icon.svg)

# Plakkert

A true end-to-end encrypted notes web app, built to work both offline & online.

![Image of the main app screen](example.png)

## Current features

- End-to-end encryption
- Works offline
  - The app is cached by a service worker, and notes are stored in IndexedDB
  - Notes can be created, edited and deleted offline, and sync once back online
  - Accounts that have been used on a device before can be unlocked offline
- Sync across devices (last write wins; deletions win over edits). Only what changed is fetched,
  and changes are sent in batches, so it stays quick with thousands of notes. Long lists of notes
  are shown a page at a time while scrolling.
- Sharing notes with other users, who can view or edit them
  - Only the owner can share, change permissions or stop sharing; recipients can remove a shared
    note from their own notes
  - Changing who a note is shared with needs a connection; editing shared notes works offline
- Organising notes
  - Tags, to find notes back quickly. In "Edit tags", tags can be renamed, merged (e.g. "recipe"
    into "recipes"), deleted and put in your own order, for all notes at once. Nothing changes
    until you save. The order syncs across your devices.
  - Archive, for notes you want to keep but not see
  - Trash: notes in the trash are deleted forever after 30 days, or earlier by hand
  - Your own order: drag notes around, or on a touch screen hold a note and then drag it. With the
    keyboard, Shift and the arrow keys move the selected note. The archive and the trash are in the
    order notes ended up there.
  - Several notes at once: Ctrl+click a note (⌘-click on a Mac, or Ctrl+Space) to select it, or
    turn on selecting with the button next to "New note", which also works on touch screens. While
    selecting, clicking a note selects it, Shift+click (or Shift+Space) also selects the notes
    between it and the one selected last, and Ctrl+A (⌘A on a Mac) selects all notes in the view,
    also those further down. The selected notes can be tagged, coloured, archived and moved to the trash all
    at once, or in the trash, restored and deleted forever.
  - Hidden notes: for when someone looks along, a note's text can be hidden until you open it,
    with a crossed-out eye and optionally a short message of your own in its place. Hide notes by
    selecting them, or from the eye button of an open note, where the message is set too. The
    settings can hide their tags as well.
  - Tags, archive, trash, order and hidden notes are per user: on a shared note, everyone organises it their own
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
  - Notes are locked again when the app is closed, unless "Stay logged in" is turned on in the
    settings. It then stays unlocked on that device until it hasn't been used for 30 days.
- Two notes side by side on phones, if you prefer (in the settings)
- Importing notes from Google Keep, from a Google Takeout zip (in the settings). Text, checklists,
  colours and dates come along, labels become tags, and archived notes go to the archive;
  formatting and images don't come along. Imported notes get the tag "Keep import". What will be
  imported is shown first, to confirm, and notes that were imported before are skipped. Other
  apps can be added in `src/lib/client/import/`.
- Exporting all notes as a zip of Markdown files (in the settings), in folders for the notes, the
  archive and the trash, with their tags, colour and dates as front matter. The zip can be
  encrypted with a password (AES-256); its files are then named after when each note was created,
  since a zip's file names aren't encrypted. The notes are decrypted and zipped in the browser.
- Invite-only registration (see below)
- MCP, for AI assistants and other MCP clients to search and read your notes, if the server allows
  it and you turn it on (see below)

## How encryption works

- Every user has a key pair. The private key is encrypted with a key derived from the password
  (PBKDF2, 600k iterations, random salt) before it is sent to the server.
- The password itself is never sent to the server. Instead, the client derives a separate auth key
  from it (PBKDF2 with the username as salt), which the server uses as the account password.
- Every note has its own key, which is encrypted with the owner's public key. Note contents are
  encrypted with that note key, so the server only ever stores ciphertext.
- Tags are encrypted with the note key as well, and stored per user. Archiving and trashing a note
  are special tags, so the server can't tell either, and so are a note's place in the user's order
  and whether it's hidden, with its message. Because of that, the server can't empty the
  trash itself: the app deletes notes that have been in the trash for 30 days, once it has synced,
  so a note that was restored on another device isn't deleted by mistake.
- Settings that sync across devices, such as the order of your tags, are encrypted with your own
  public key, so only you can read them.
- Searching happens in the browser, on the decrypted notes, so it also works offline.
- Sharing a note encrypts its note key with the recipient's public key, so the server never sees it.
  The recipient's public key is fetched from the server and not verified, so this relies on the
  server handing out the right key. Stopping sharing does not change the note key, so someone who
  had access could still decrypt the note if they got hold of its ciphertext later.
- MCP is the exception to end-to-end encryption, while it's on: see below.

## MCP

MCP clients, such as Claude, ChatGPT, Claude Code or VS Code, can search and read a user's notes,
but not change them. It's off unless the server allows it, with the `MCP` environment variable
set to `on` (read when the server starts), and then still off for each user until they turn it on
in the settings. There they find the address to add to their app (`https://<your domain>/mcp`),
and the apps they connected, which they can disconnect.

- Apps sign in with OAuth 2.1, with the app as its own authorization server, as the MCP
  specification describes: discovery metadata (RFC 9728 and RFC 8414), dynamic client registration
  (RFC 7591), PKCE, tokens that are only valid for the MCP endpoint (RFC 8707), access tokens that
  last an hour and refresh tokens that rotate. Using a code or refresh token a second time
  disconnects the app, as it may have leaked. Client ID Metadata Documents aren't supported, as
  fetching a URL an app names would let anyone make the server request URLs of their choosing.
- The server can't read notes, so for an app to read them, the server decrypts them for it. When a
  user approves an app, their browser encrypts their private key with a new random secret. That
  secret only goes to the app, inside its authorization code and then its tokens; the server keeps
  the encrypted key and hashes of the tokens, never the secret. So the database alone can't
  decrypt anything. While an app makes a request, its token unlocks the key, which decrypts the
  user's notes for that request only and is then cleared from memory.
- That does mean that while a user has MCP on, the server sees the notes an app reads, so they're
  only as safe as the server is during those requests. Turning MCP off, or disconnecting an app,
  deletes its copy of the key.
- An app only ever sees the notes of the user who approved it: every request is answered by a new
  MCP server for just that user. Responses aren't cached, requests from pages on other sites are
  refused, and registration, tokens and MCP requests are rate limited.
- `ORIGIN` must be the app's public HTTPS address: tokens are only valid for it. Behind a reverse
  proxy, set adapter-node's `ADDRESS_HEADER` (e.g. `X-Forwarded-For`), so rate limits apply per
  client rather than to the proxy, and make sure `/.well-known/` reaches the app.

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

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
- Note history, if you turn it on in the settings: earlier versions of notes, to go back to if
  something was changed or removed by mistake. An open note shows when it was last edited, with a
  button for its history, where versions can be looked at and restored. Restoring keeps what it
  replaces, so it can be undone too.
  - A version is kept each time you start changing a note after a break of 10 minutes or more,
    and at least every hour while you keep at it; also when an edit loses to a newer one from
    another device, and before an MCP app changes a note. All versions are kept for a day, then
    one a day for a month, then one a week, up to 90 days, and at most 5 MB per note.
  - Versions are kept on the server and on the devices that made them, so the history also works
    offline. It's only fetched from the server when you open it, so syncing stays as quick.
  - A note's history follows its owner: people a note is shared with only see it if the owner
    keeps it (and they have history on themselves), and then only versions from after it was
    shared with them.
  - Turning it off deletes the history of all your notes, on the server and on all your devices.
    Deleting a note forever deletes its history too.
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
  - Changing your password (in the settings), which logs out your other devices. A forgotten
    password can't be reset, as it's what unlocks your notes.
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
- Backups (in the settings): a zip with everything of a user's on the server, exactly as it's
  stored there, so still encrypted: their notes, also deleted ones, with their history, their tags,
  settings, and who they shared notes with, but not notes others shared with them. Restoring one
  merges it: notes that are missing or were deleted come back, also on the user's other devices,
  and notes that are older than in the backup get its text, keeping what they had in their history.
  Nothing is deleted, so restoring twice, or an old backup, loses nothing. A backup of another
  account, e.g. from another server, can be restored into a new account, made from it on the
  register page with the password the backup was made with. Uploads go in pieces, so the server's
  request size limit (adapter-node's `BODY_SIZE_LIMIT`) can stay as it is.
- Invite-only registration (see below)
- MCP, for AI assistants and other MCP clients to search, read and change your notes, as far as you
  allow each one, if the server allows it and you turn it on (see below)

## How encryption works

- Every user has a key pair. The private key is encrypted with a key derived from the password
  (PBKDF2, 600k iterations, random salt) before it is sent to the server.
- The password itself is never sent to the server. Instead, the client derives a separate auth key
  from it (PBKDF2 with the username as salt), which the server uses as the account password.
- Changing the password encrypts the same private key with the new password, so the key pair, and
  with it every note and share, stays as it is. The server only accepts it with the current auth
  key, and replaces the auth key and the encrypted private key together, so they can't get out of
  step and lock the user out. That's the only way to change them: Better Auth's update-user is
  turned off, so a stolen session alone can't replace a user's keys or username.
- Backups are the database's rows as they are, so the server can't read them either. They do hold
  the private key, encrypted with the password, as the server does. Restoring only takes a backup
  with the account's own public key, as everything in it is encrypted for that key. A new account
  made from a backup gets the backup's key pair: the browser decrypts the private key with the
  password first, checks it belongs to the public key, and encrypts it again for the new account.
  Notes are shared again only with people who still have the key they were shared with.
- Every note has its own key, which is encrypted with the owner's public key. Note contents are
  encrypted with that note key, so the server only ever stores ciphertext.
- Tags are encrypted with the note key as well, and stored per user. Archiving and trashing a note
  are special tags, so the server can't tell either, and so are a note's place in the user's order
  and whether it's hidden, with its message. Because of that, the server can't empty the
  trash itself: the app deletes notes that have been in the trash for 30 days, once it has synced,
  so a note that was restored on another device isn't deleted by mistake.
- Settings that sync across devices, such as the order of your tags, are encrypted with your own
  public key, so only you can read them.
- Note history keeps earlier versions encrypted with the note key, like the notes. So while it's
  on, the server keeps ciphertext it would otherwise have overwritten: text removed from a note
  stays in its history until it expires, or history is turned off. Which versions to keep is
  decided by their times and sizes, which the server sees anyway, so it can thin them out without
  reading them. Whether a user keeps history is stored as is, so the server knows which notes to
  keep versions of.
- Searching happens in the browser, on the decrypted notes, so it also works offline.
- Sharing a note encrypts its note key with the recipient's public key, so the server never sees it.
  The recipient's public key is fetched from the server and not verified, so this relies on the
  server handing out the right key. Stopping sharing does not change the note key, so someone who
  had access could still decrypt the note if they got hold of its ciphertext later.
- MCP is the exception to end-to-end encryption, while it's on: see below.

## MCP

MCP clients, such as Claude, ChatGPT, Claude Code or VS Code, can use a user's notes, as far as the
user allows each one. It's off unless the server allows it, with the `MCP` environment variable
set to `on` (read when the server starts), and then still off for each user until they turn it on
in the settings. There they find the address to add to their app (`https://<your domain>/mcp`),
and the apps they connected, which they can change the permissions of, or disconnect.

What an app may do is chosen when connecting it, and can be changed later in the settings:

- **Read**: search and read notes and tags, with or without hidden notes, and limited by tags:
  only notes with one of some tags (include), or all but notes with any of them (exclude). Notes
  out of reach are left out of every result, and can't be changed or shared either.
- **Write**: create notes; edit their text; delete them (to the trash, from where they can be
  restored); tag, colour, archive and hide them, and undo that; and share the user's own notes.
  All but creating need Read, and only reach the notes Read does. An app can't give notes a tag
  that's excluded from its reach. Notes are written as Markdown, and turned into what the editor
  stores; formatting Markdown doesn't have, such as underlining, is lost when an app replaces a
  note's text.
- **Backups**: download and restore backups (see below), off unless chosen. These go past Read and
  its tags: a backup has all of the user's notes, though still encrypted, so the app can't read
  them. But it does hold the private key, encrypted with the password, which the app could try to
  guess offline. Backups move through links that work for 30 minutes, which the app downloads from
  and uploads to with its own tools, such as curl; uploads go in pieces of 256 KB, and the tool
  gives the shell command for it. An app can only restore a backup of the same account.

The tools an app gets follow its permissions, so it isn't offered what it may not do. Apps
connected before there were permissions can still read everything, as before, and nothing else.

- Apps sign in with OAuth 2.1, with the app as its own authorization server, as the MCP
  specification describes: discovery metadata (RFC 9728 and RFC 8414), dynamic client registration
  (RFC 7591), PKCE, tokens that are only valid for the MCP endpoint (RFC 8707), access tokens that
  last an hour and refresh tokens that rotate. Using a code or refresh token a second time
  disconnects the app, as it may have leaked. Client ID Metadata Documents aren't supported, as
  fetching a URL an app names would let anyone make the server request URLs of their choosing.
- The server can't read notes, so for an app to use them, the server decrypts them for it. When a
  user approves an app, their browser encrypts their private key with a new random secret. That
  secret only goes to the app, inside its authorization code and then its tokens; the server keeps
  the encrypted key and hashes of the tokens, never the secret. So the database alone can't
  decrypt anything. While an app makes a request, its token unlocks the key, which decrypts the
  user's notes for that request only and is then cleared from memory. Changes are encrypted like
  the app does, and stored like the app's own, so they sync to the user's devices.
- The tags of an app's filter are encrypted with the user's public key, by their browser, so the
  server can only read them during the app's requests too. One that can't be decrypted leaves the
  app no notes at all. Renaming a tag in the app renames it in the filters as well, when online;
  deleting a tag leaves it in them, so an app limited to it doesn't get to see more.
- That does mean that while a user has MCP on, the server sees the notes an app uses, so they're
  only as safe as the server is during those requests. Turning MCP off, or disconnecting an app,
  deletes its copy of the key.
- An app only ever sees the notes of the user who approved it: every request is answered by a new
  MCP server for just that user. Responses aren't cached, requests from pages on other sites are
  refused, and registration, tokens and MCP requests are rate limited. Registration allows 20
  clients per IP address per hour; set `MCP_REGISTRATIONS_PER_HOUR` for more.
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

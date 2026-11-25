# Features

## End-to-end encryption

Notes, tags, colours, the order of notes and settings are encrypted in the browser, so the server
only ever stores ciphertext. See [How encryption works](encryption.md).

## Works offline

- The app is cached by a service worker, and notes are stored in IndexedDB.
- Notes can be created, edited and deleted offline, and sync once back online.
- Accounts that have been used on a device before can be unlocked offline.

## Sync across devices

Last write wins; deletions win over edits. Only what changed is fetched, and changes are sent in
batches, so it stays quick with thousands of notes. Long lists of notes are shown a page at a time
while scrolling.

## Sharing

Notes can be shared with other users, who can view or edit them.

- Only the owner can share, change permissions or stop sharing; recipients can remove a shared
  note from their own notes.
- Changing who a note is shared with needs a connection; editing shared notes works offline.

## Organising notes

- **Tags**, to find notes back quickly. In "Edit tags", tags can be renamed, merged (e.g. "recipe"
  into "recipes"), deleted and put in your own order, for all notes at once. Nothing changes until
  you save. The order syncs across your devices.
- **Archive**, for notes you want to keep but not see.
- **Trash**: notes in the trash are deleted forever after 30 days, or earlier by hand.
- **Your own order**: drag notes around, or on a touch screen hold a note and then drag it. With
  the keyboard, Shift and the arrow keys move the selected note. The archive and the trash are in
  the order notes ended up there.
- **Several notes at once**: Ctrl+click a note (⌘-click on a Mac, or Ctrl+Space) to select it, or
  turn on selecting with the button next to "New note", which also works on touch screens. While
  selecting, clicking a note selects it, Shift+click (or Shift+Space) also selects the notes
  between it and the one selected last, and Ctrl+A (⌘A on a Mac) selects all notes in the view,
  also those further down. The selected notes can be tagged, coloured, archived and moved to the
  trash all at once, or in the trash, restored and deleted forever.
- **Hidden notes**: for when someone looks along, a note's text can be hidden until you open it,
  with a crossed-out eye and optionally a short message of your own in its place. Hide notes by
  selecting them, or from the eye button of an open note, where the message is set too. The
  settings can hide their tags as well.

Tags, archive, trash, order and hidden notes are per user: on a shared note, everyone organises it
their own way, and only deleting it forever from the trash deletes it for everyone.

## Note history

If you turn it on in the settings: earlier versions of notes, to go back to if something was
changed or removed by mistake. An open note shows when it was last edited, with a button for its
history, where versions can be looked at and restored. Restoring keeps what it replaces, so it can
be undone too.

- A version is kept each time you start changing a note after a break of 10 minutes or more, and
  at least every hour while you keep at it; also when an edit loses to a newer one from another
  device, and before an MCP app changes a note. All versions are kept for a day, then one a day
  for a month, then one a week, up to 90 days, and at most 5 MB per note.
- Versions are kept on the server and on the devices that made them, so the history also works
  offline. It's only fetched from the server when you open it, so syncing stays as quick.
- A note's history follows its owner: people a note is shared with only see it if the owner keeps
  it (and they have history on themselves), and then only versions from after it was shared with
  them.
- Turning it off deletes the history of all your notes, on the server and on all your devices.
  Deleting a note forever deletes its history too.

## Search

Search through the text and tags of notes (`/` jumps to the search field). Searching happens in
the browser, so it also works offline.

## Editing

Ten note colours, and plain text, bold, italics, inline code, code blocks and checklists.

## Accounts

- Notes are locked again when the app is closed, unless "Stay logged in" is turned on in the
  settings. It then stays unlocked on that device until it hasn't been used for 30 days.
- Changing your password (in the settings) logs out your other devices. A forgotten password can't
  be reset, as it's what unlocks your notes.
- Registration is invite-only by default; see [Self-hosting](self-hosting.md#registration).

## Phones

Two notes side by side on phones, if you prefer (in the settings).

## Importing from Google Keep

From a Google Takeout zip (in the settings). Text, checklists, colours and dates come along, labels
become tags, and archived notes go to the archive; formatting and images don't come along.
Imported notes get the tag "Keep import". What will be imported is shown first, to confirm, and
notes that were imported before are skipped.

## Exporting

All notes as a zip of Markdown files (in the settings), in folders for the notes, the archive and
the trash, with their tags, colour and dates as front matter. The zip can be encrypted with a
password (AES-256); its files are then named after when each note was created, since a zip's file
names aren't encrypted. The notes are decrypted and zipped in the browser.

## Backups

In the settings: a zip with everything of a user's on the server, exactly as it's stored there, so
still encrypted: their notes, also deleted ones, with their history, their tags, settings, and who
they shared notes with, but not notes others shared with them.

Restoring one merges it: notes that are missing or were deleted come back, also on the user's
other devices, and notes that are older than in the backup get its text, keeping what they had in
their history. Nothing is deleted, so restoring twice, or an old backup, loses nothing.

A backup of another account, e.g. from another server, can be restored into a new account, made
from it on the register page with the password the backup was made with. Uploads go in pieces, so
the server's request size limit (adapter-node's `BODY_SIZE_LIMIT`) can stay as it is.

## MCP

AI assistants and other MCP clients can search, read and change your notes, as far as you allow
each one, if the server allows it and you turn it on. See [MCP](mcp.md).

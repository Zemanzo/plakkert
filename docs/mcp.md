# MCP

MCP clients, such as Claude, ChatGPT, Claude Code or VS Code, can use a user's notes, as far as the
user allows each one. It's off unless the server allows it, with the `MCP` environment variable
set to `on` (read when the server starts), and then still off for each user until they turn it on
in the settings. There they find the address to add to their app (`https://<your domain>/mcp`),
and the apps they connected, which they can change the permissions of, or disconnect.

## Permissions

What an app may do is chosen when connecting it, and can be changed later in the settings:

- **Read**: search and read notes and tags, with or without hidden notes, and limited by tags:
  only notes with one of some tags (include), or all but notes with any of them (exclude). Notes
  out of reach are left out of every result, and can't be changed or shared either.
- **Write**: create notes; edit their text; delete them (to the trash, from where they can be
  restored); tag, color, archive and hide them, and undo that; and share the user's own notes.
  All but creating need Read, and only reach the notes Read does. An app can't give notes a tag
  that's excluded from its reach. Notes are written as Markdown, and turned into what the editor
  stores; formatting Markdown doesn't have, such as underlining, is lost when an app replaces a
  note's text.
- **Backups**: download and restore [backups](features.md#backups), off unless chosen. These go
  past Read and its tags: a backup has all of the user's notes, though still encrypted, so the app
  can't read them. But it does hold the private key, encrypted with the password, which the app
  could try to guess offline. Backups move through links that work for 30 minutes, which the app
  downloads from and uploads to with its own tools, such as curl; uploads go in pieces of 256 KB,
  and the tool gives the shell command for it. An app can only restore a backup of the same
  account.

The tools an app gets follow its permissions, so it isn't offered what it may not do. Apps
connected before there were permissions can still read everything, as before, and nothing else.

## How it works

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

## Server setup

- `ORIGIN` must be the app's public HTTPS address: tokens are only valid for it.
- Behind a reverse proxy, set adapter-node's `ADDRESS_HEADER` (e.g. `X-Forwarded-For`), so rate
  limits apply per client rather than to the proxy, and make sure `/.well-known/` reaches the app.

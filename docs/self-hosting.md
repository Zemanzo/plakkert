# Self-hosting

Plakkert is a single Node.js server with a SQLite database, so one small container is all it needs.
The server only ever stores encrypted notes (see [How encryption works](encryption.md)), but it does
serve the app's code, so it should still be one you trust.

## Docker

```sh
docker build -t plakkert \
  --build-arg ORIGIN=https://notes.example.com \
  --build-arg DATABASE_URL=/data/plakkert.db \
  --build-arg PUBLIC_APP_NAME=plakkert \
  --build-arg BETTER_AUTH_SECRET=<32 random characters> \
  .

docker volume create plakkert-data
docker run -d --name plakkert -p 127.0.0.1:3016:3016 -v plakkert-data:/data \
  -e ORIGIN=https://notes.example.com \
  -e DATABASE_URL=/data/plakkert.db \
  -e BETTER_AUTH_SECRET=<the same secret> \
  -e INVITE_CODE=<an invite code> \
  plakkert
```

The app listens on port 3016 and keeps its database in `/data`. Migrations are applied when the
server starts. Put it behind a reverse proxy that serves it over HTTPS: the service worker, and so
working offline, needs HTTPS.

Behind a reverse proxy, set adapter-node's `ADDRESS_HEADER` (e.g. `X-Forwarded-For`, with
`XFF_DEPTH`), so rate limits apply per client rather than to the proxy.

## Environment variables

See also `.env.example`.

| Variable                     | When read         | What it does                                                                                                        |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`                     | build and runtime | The app's public address, e.g. `https://notes.example.com`. Used for CSRF checks, Better Auth and MCP tokens.       |
| `DATABASE_URL`               | runtime           | Path to the SQLite database file.                                                                                   |
| `BETTER_AUTH_SECRET`         | runtime           | Secret that signs sessions. Use 32 random characters.                                                               |
| `REGISTRATION`               | runtime           | Who can create an account: `invite` (the default), `open` or `closed`. See [Registration](#registration).           |
| `INVITE_CODE`                | runtime           | The code needed to register when `REGISTRATION` is `invite`.                                                        |
| `MCP`                        | runtime           | `on` lets users connect AI assistants and other MCP clients to their notes; `off` (the default). See [MCP](mcp.md). |
| `MCP_REGISTRATIONS_PER_HOUR` | runtime           | How many MCP clients can register from one IP address per hour (20 by default).                                     |
| `PUBLIC_APP_NAME`            | build             | The name used for IndexedDB and other storage in the browser.                                                       |
| `BODY_SIZE_LIMIT`            | runtime           | adapter-node's request size limit. Backups are uploaded in pieces, so the default is fine.                          |

## Registration

Who can create an account is set with the `REGISTRATION` environment variable, read when the
server starts:

- `invite` (the default): only people with the invite code in `INVITE_CODE`. Without an invite
  code, nobody can register. Share an invite as a link:
  `https://<your domain>/register?invite=<code>`.
- `open`: anyone.
- `closed`: nobody.

The server enforces this on the sign-up endpoint itself, and rate limits sign-up attempts. Changing
the invite code stops old invites from working; existing accounts are not affected.

## MCP

With `MCP=on`, make sure `/.well-known/` reaches the app through the reverse proxy, as MCP clients
discover how to sign in there. More in [MCP](mcp.md).

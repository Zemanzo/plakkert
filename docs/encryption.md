# How encryption works

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
- MCP is the exception to end-to-end encryption, while it's on: see [MCP](mcp.md).

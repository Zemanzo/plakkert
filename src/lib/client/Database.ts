import { PUBLIC_APP_NAME } from '$env/static/public';
import { Dexie, type EntityTable } from "dexie"

interface User {
  id: string
  email: string
  privateKey: ArrayBuffer
  passwordHash: ArrayBuffer
  salt: Uint8Array
  nonce: Uint8Array
}

interface Note {
  id: number,
  ownerId: number,
  content: string,
  createdAt: Date,
  updatedAt: Date,
}

const db = new Dexie(PUBLIC_APP_NAME) as Dexie & {
  users: EntityTable<
    User,
    "id" // primary key "id" (for the typings only)
  >
  // notes: EntityTable<
  //   Note,
  //   "id" // primary key "id" (for the typings only)
  // >
}

// Schema declaration:
db.version(1).stores({
  users: "++id, email, privateKey, passwordHash, salt, nonce",
  // notes: "++id, ownerId, content, createdAt, updatedAt"
})

export type { User }
export { db }

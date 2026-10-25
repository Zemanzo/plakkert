import { type User } from '#lib/client/Database.js';

export type RuntimeUser = User & {
	decodedPrivateKey: Uint8Array | null;
	publicKeyUint8: Uint8Array;
};

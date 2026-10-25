import { type User } from '#lib/client/Database.js';

export type RuntimeUser = User & {
	decodedPrivateKey: Uint8Array;
	publicKeyUint8: Uint8Array;
};

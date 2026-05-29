import { type User } from '$lib/client/Database';

export type RuntimeUser = User & {
	decodedPrivateKey: Uint8Array | null;
	publicKeyUint8: Uint8Array;
};

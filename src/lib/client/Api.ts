/** Thrown when the server can't be reached, e.g. because the device is offline. */
export class OfflineError extends Error {}

/** Thrown when the server responds with an error. */
export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly code?: string
	) {
		super(message);
	}
}

/** Wrapper around fetch that turns network failures into an {@link OfflineError}. */
export async function fetchOrOffline(input: string, init?: RequestInit) {
	try {
		return await fetch(input, init);
	} catch (error) {
		throw new OfflineError('Could not reach the server', { cause: error });
	}
}

/** Creates an {@link ApiError} from an error response. */
export async function toApiError(response: Response) {
	const body = await response.json().catch(() => null);
	return new ApiError(
		body?.message ?? `Request failed with status ${response.status}`,
		response.status,
		body?.code
	);
}

/**
 * Wrapper around fetch that turns network failures into an {@link OfflineError}
 * and error responses into an {@link ApiError}.
 */
export async function request(input: string, init?: RequestInit) {
	const response = await fetchOrOffline(input, init);
	if (!response.ok) {
		throw await toApiError(response);
	}
	return response;
}

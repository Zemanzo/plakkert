/**
 * Counts requests per key (e.g. per IP address) in fixed windows, in memory, which is enough for
 * a single server process. Returns a function that tells whether a request is allowed.
 */
export function rateLimiter(limit: number, windowMs: number) {
	const windows = new Map<string, { start: number; count: number }>();
	return (key: string, now = Date.now()) => {
		// Forget old windows now and then, so the map doesn't grow without bound.
		if (windows.size > 10_000) {
			for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
		}
		const window = windows.get(key);
		if (!window || now - window.start >= windowMs) {
			windows.set(key, { start: now, count: 1 });
			return true;
		}
		window.count++;
		return window.count <= limit;
	};
}

/**
 * A fixed-window request limit per credential, in memory per server instance
 * (good enough for one instance; a shared store would replace this).
 */

const WINDOW_MS = 60_000;
export const MCP_RATE_LIMIT = 120;

const windows = new Map<string, { start: number; count: number }>();

/** Count one request; returns the seconds to wait when over the limit, else null. */
export function hitRateLimit(key: string, now = Date.now(), limit = MCP_RATE_LIMIT): number | null {
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    if (windows.size > 10_000) sweep(now);
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  return Math.max(1, Math.ceil((current.start + WINDOW_MS - now) / 1000));
}

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (now - window.start >= WINDOW_MS) windows.delete(key);
  }
}

export function resetRateLimits() {
  windows.clear();
}

/**
 * Shared fetch helpers for the client-side API modules. Every helper throws an
 * `Error` (message from the API's `{ error }` shape) on a non-2xx response so
 * React Query's error paths can surface it via a sonner toast.
 */

export async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    // Non-JSON body; keep the fallback message.
  }
  throw new Error(message);
}

/** fetch + JSON with the error convention above. `body` is JSON-encoded. */
export async function request<T>(
  url: string,
  fallback: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) await parseError(res, fallback);
  return (await res.json()) as T;
}

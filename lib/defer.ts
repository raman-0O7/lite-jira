import { after } from "next/server";

/**
 * Run side effects (calls to GitHub, agent dispatch) after the response is
 * sent, so a slow or failing third party never blocks or fails the write that
 * triggered it. Outside a request (tests, scripts) the task starts right away
 * and `flushDeferred()` waits for it.
 */

const pending = new Set<Promise<void>>();

export function defer(label: string, task: () => Promise<unknown>) {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[deferred:${label}]`, error instanceof Error ? error.message : error);
    }
  };
  try {
    after(run);
  } catch {
    const promise = run();
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
  }
}

/** Wait for deferred tasks started outside a request. */
export async function flushDeferred() {
  while (pending.size) await Promise.all([...pending]);
}

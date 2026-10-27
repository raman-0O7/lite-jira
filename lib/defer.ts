import { after } from "next/server";

/**
 * Run side effects (calls to GitHub, agent dispatch) after the response is
 * sent, so a slow or failing third party never blocks or fails the write that
 * triggered it. Outside a request (tests, scripts) the task is queued, like
 * `after()` would, and runs when `flushDeferred()` is called.
 */

const queued: (() => Promise<void>)[] = [];

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
    queued.push(run);
  }
}

/** Run deferred tasks queued outside a request, including any they queue. */
export async function flushDeferred() {
  while (queued.length) await Promise.all(queued.splice(0).map((run) => run()));
}

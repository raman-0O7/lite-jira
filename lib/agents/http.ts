/** Outbound HTTP for agent adapters; swappable so tests use a fake. */
type Fetch = typeof fetch;
let impl: Fetch = (...args) => fetch(...args);

export function setAgentFetch(next: Fetch | null) {
  impl = next ?? ((...args) => fetch(...args));
}

export const agentFetch: Fetch = (...args) => impl(...args);

/** A dispatch failure with a message safe to show (never contains secrets). */
export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

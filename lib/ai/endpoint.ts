import { createGuardedFetch } from "guarded-fetch";

import { badRequest } from "@/lib/services/errors";

/**
 * Custom (OpenAI-compatible) endpoints (docs/features/24-multi-provider-ai.md
 * "Custom endpoints: the URL rule"). A base URL is somewhere Kanso's server
 * will send requests, so it gets the same care as webhook URLs: https on a
 * public host, checked when saved, and checked again on every connection
 * against the address it resolves to (guarded-fetch pins the resolved IP at
 * connect time, so a DNS change after saving can't point Kanso at internal
 * services). Redirects are never followed.
 */

const NAMED_PRIVATE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Outside production, http://localhost (and 127.0.0.1) is allowed for local model servers. */
const isDevLocal = (url: URL) =>
  process.env.NODE_ENV !== "production" &&
  url.protocol === "http:" &&
  (url.hostname === "localhost" || url.hostname === "127.0.0.1");

function isPrivateLiteral(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (NAMED_PRIVATE.test(host)) return true;
  if (IPV4.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) {
    // Any IPv6 literal that isn't plainly global unicast (2000::/3) is refused.
    return !/^[23][0-9a-f]{0,3}:/.test(host);
  }
  return false;
}

/** The base URL as stored: validated, without a trailing slash, query or fragment. Throws a 400. */
export function normalizeEndpointUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest("That base URL isn't a valid URL");
  }
  if (url.username || url.password) throw badRequest("Put the key in the API key field, not in the URL");
  if (!isDevLocal(url)) {
    if (url.protocol !== "https:") throw badRequest("The base URL must use https");
    if (isPrivateLiteral(url.hostname)) throw badRequest("The base URL must be a public host");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

let guarded: ReturnType<typeof createGuardedFetch> | null = null;
let override: typeof fetch | null = null;

/** Tests swap the transport (no network); null restores the guarded one. */
export function setEndpointFetch(next: typeof fetch | null) {
  override = next;
}

/**
 * The fetch for a custom endpoint: guarded (DNS-checked at connect time, no
 * redirects), except for a local model server during development.
 */
export function endpointFetch(baseUrl: string): typeof fetch {
  if (override) return override;
  if (isDevLocal(new URL(baseUrl))) return fetch;
  guarded ??= createGuardedFetch();
  const transport = guarded;
  return ((input: RequestInfo | URL, init?: RequestInit) => transport(input, { ...init, redirect: "error" })) as typeof fetch;
}

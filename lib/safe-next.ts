/**
 * Where to send someone after signing in: the `next` path if it stays on this
 * site, otherwise the default landing. Rejects absolute and protocol-relative
 * URLs ("//evil.com", "/\\evil.com") so `?next=` can't be an open redirect.
 */
export function safeNext(next: string | string[] | undefined | null): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    // Browsers drop tabs and newlines and read a backslash as "/", which
    // would turn "/<tab>/evil.com" back into a protocol-relative URL.
    /[\\\u0000-\u001f]/.test(value)
  ) {
    return "/projects";
  }
  return value;
}

/** `path` with `?next=` added when it isn't the default landing. */
export function withNext(path: string, next: string): string {
  return next === "/projects" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

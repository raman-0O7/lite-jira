import { type NextRequest, NextResponse } from "next/server";

/**
 * Hands the requested path to server components (as `x-kanso-path`), so the
 * sign-in redirect in requireUser() can bring people back to the page they
 * asked for. Always overwritten here, so a client can't supply its own; the
 * value is still sanitised by safeNext() before use. Auth itself stays in
 * app/(app)/layout.tsx.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-kanso-path", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not API routes, Next internals, discovery, or files.
  matcher: ["/((?!api|_next/static|_next/image|\\.well-known|.*\\.[A-Za-z0-9]+$).*)"],
};

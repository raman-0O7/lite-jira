import { auth } from "@/lib/auth";

/**
 * OAuth discovery for MCP clients. Better Auth serves these documents (RFC 9728
 * protected-resource metadata for /api/mcp, RFC 8414 metadata for the
 * /api/auth issuer), but Next only routes /api/auth/* to it, so the root
 * well-known paths forward here. Unknown paths get Better Auth's 404.
 */
function handle(request: Request) {
  return auth.handler(request);
}

export { handle as GET, handle as HEAD };

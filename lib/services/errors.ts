/**
 * Errors thrown by the service layer.
 *
 * Services never build HTTP responses; they throw a `ServiceError` with the
 * status the caller should surface. Route handlers map it to `{ error }` JSON
 * (see lib/api/handler.ts); MCP tools and other entry points map it their own way.
 */
export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServiceError";
  }
}

export const badRequest = (message: string) => new ServiceError(400, message);
export const unauthorized = (message = "Unauthorized") =>
  new ServiceError(401, message);
export const forbidden = (message = "You don't have permission to do that") =>
  new ServiceError(403, message);
export const notFound = (message = "Not found") => new ServiceError(404, message);
/**
 * The server is missing configuration the request needs. People see that the
 * fault is ours, not their input; `detail` (what to fix) goes to the server log only.
 */
export const misconfigured = (detail: string) =>
  new ServiceError(503, "Kanso couldn't do this because of a problem on our side. Nothing you entered was wrong.", {
    cause: new Error(detail),
  });

import { hmacHex, safeEqual } from "@/lib/crypto";

/** Verify GitHub's `X-Hub-Signature-256` header against the raw request body. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${hmacHex(secret, rawBody)}`);
}

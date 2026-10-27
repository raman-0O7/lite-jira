import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets Kanso must be able to read back (agent fire tokens, outbound webhook
 * secrets) are stored encrypted with AES-256-GCM under ENCRYPTION_KEY.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 */

function keyMaterial(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (key) {
    if (key.length < 32) throw new Error("ENCRYPTION_KEY must be at least 32 characters");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is not set");
  // Development and tests: derive from the auth secret so setup stays small.
  return `dev:${process.env.BETTER_AUTH_SECRET ?? "kanso-development-only"}`;
}

const encryptionKey = () => createHash("sha256").update(`kanso-encryption:${keyMaterial()}`).digest();

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 hex digest. */
export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const stateSecret = () => `kanso-state:${process.env.BETTER_AUTH_SECRET ?? keyMaterial()}`;

/** A tamper-proof, expiring token carrying a small JSON payload (OAuth `state`). */
export function signState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmacHex(stateSecret(), body)}`;
}

/** The payload of a state from `signState`, or null if forged or expired. */
export function verifyState<T extends Record<string, unknown>>(state: string): T | null {
  const [body, mac] = state.split(".");
  if (!body || !mac || !safeEqual(mac, hmacHex(stateSecret(), body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

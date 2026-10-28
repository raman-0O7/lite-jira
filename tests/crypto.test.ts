import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/lib/services/errors";

import { errorResponse } from "@/lib/api/handler";
import { decrypt, encrypt } from "@/lib/crypto";

/** What an API route answers when encrypting fails. */
async function encryptFailure() {
  try {
    encrypt("secret");
  } catch (error) {
    const response = errorResponse(error);
    return {
      status: response.status,
      error: (await response.json()).error as string,
      logged: ((error as ServiceError).cause as Error).message,
    };
  }
  throw new Error("encrypt didn't fail");
}

describe("crypto", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("round-trips a secret", () => {
    expect(decrypt(encrypt("sk-ant-oat01-secret"))).toBe("sk-ant-oat01-secret");
  });

  it("says a missing ENCRYPTION_KEY is our fault, and logs the cause without sending it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENCRYPTION_KEY", "");
    const failure = await encryptFailure();
    expect(failure).toMatchObject({ status: 503, logged: "ENCRYPTION_KEY is not set" });
    expect(failure.error).toMatch(/problem on our side/);
    expect(failure.error).not.toMatch(/ENCRYPTION_KEY/);
    expect(console.error).toHaveBeenCalled();
  });

  it("treats a short ENCRYPTION_KEY the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ENCRYPTION_KEY", "too-short");
    const failure = await encryptFailure();
    expect(failure).toMatchObject({ status: 503, logged: expect.stringMatching(/at least 32/) });
    expect(failure.error).not.toMatch(/ENCRYPTION_KEY/);
  });
});

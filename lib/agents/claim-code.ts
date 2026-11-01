import { createHash, randomBytes } from "node:crypto";

/**
 * One-time code sent with a Claude Code routine fire (docs/features/17-personal-agents.md
 * "Claim codes"). The session passes it to claim_issue, which proves Kanso
 * started that session for that run, whichever Kanso user its connector is
 * signed in as. Only the hash is stored.
 */
export function newClaimCode() {
  const code = `kcc_${randomBytes(18).toString("base64url")}`;
  return { code, hash: hashClaimCode(code) };
}

export const hashClaimCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");

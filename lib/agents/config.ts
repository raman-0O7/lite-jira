import { z } from "zod";

import { decrypt, encrypt } from "@/lib/crypto";
import { badRequest } from "@/lib/services/errors";

/** An agent's secret configuration, stored encrypted (docs/features/12-agents.md "Model"). */
export type ClaudeCodeConfig = { fireUrl: string; token: string };
export type McpAgentConfig = { webhookUrl: string | null; webhookSecret: string };
export type AgentConfig = ClaudeCodeConfig | McpAgentConfig;

export const FIRE_URL_PATTERN = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/;

export const claudeCodeConfigSchema = z.object({
  fireUrl: z
    .string()
    .trim()
    .regex(FIRE_URL_PATTERN, "Paste the routine's fire URL (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire)"),
  token: z.string().trim().min(20, "Paste the routine's token").max(500),
});

export const encryptConfig = (config: AgentConfig) => encrypt(JSON.stringify(config));
export const decryptConfig = <T extends AgentConfig>(configEnc: string) => JSON.parse(decrypt(configEnc)) as T;

/** Minutes a dispatched run may stay unclaimed before the watchdog fails it. */
export function claimTimeoutMinutes() {
  const value = Number(process.env.AGENT_CLAIM_TIMEOUT_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1?\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/**
 * Outbound webhook URLs must be HTTPS on a public host, so an agent config
 * can't point Kanso at internal services. (Plain http://localhost is allowed
 * outside production for local agents.)
 */
export function assertWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Webhook URL isn't a valid URL");
  }
  const devLocal = process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost";
  if (devLocal) return url.toString();
  if (url.protocol !== "https:") throw badRequest("Webhook URL must use https");
  if (PRIVATE_HOST.test(url.hostname)) throw badRequest("Webhook URL must be a public host");
  return url.toString();
}

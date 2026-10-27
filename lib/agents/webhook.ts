import type { McpAgentConfig } from "@/lib/agents/config";
import { agentFetch, DispatchError } from "@/lib/agents/http";
import { hmacHex } from "@/lib/crypto";

/** Notify a generic MCP agent of new work: a signed JSON POST (X-Kanso-Signature). */
export async function postAgentWebhook(config: McpAgentConfig, payload: Record<string, unknown>) {
  if (!config.webhookUrl) return;
  const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await agentFetch(config.webhookUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Kanso",
        "X-Kanso-Event": String(payload.event),
        "X-Kanso-Signature": `sha256=${hmacHex(config.webhookSecret, body)}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DispatchError("Couldn't reach the agent's webhook");
  }
  if (!response.ok) throw new DispatchError(`The agent's webhook answered ${response.status}`);
}

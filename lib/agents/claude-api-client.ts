import Anthropic from "@anthropic-ai/sdk";

import { type ClaudeApiConfig, decryptConfig } from "@/lib/agents/config";
import { db } from "@/lib/db";

/**
 * The Anthropic client for the workspace agent
 * (docs/features/18-workspace-agent.md), built per call from the workspace's
 * own API key. Swappable so tests run against a fake.
 */

type Factory = (apiKey: string) => Anthropic;
const defaultFactory: Factory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
let factory: Factory = defaultFactory;

export function setAnthropicClientFactory(next: Factory | null) {
  factory = next ?? defaultFactory;
}

export const anthropicClient = (apiKey: string) => factory(apiKey);

/** A short, safe description of an Anthropic API failure (never the key, never a stack). */
export function describeAnthropicError(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.AuthenticationError) return { status: 401, message: "Claude rejected the API key" };
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { status: 403, message: "That API key isn't allowed to use Claude Managed Agents" };
  }
  if (error instanceof Anthropic.RateLimitError) return { status: 429, message: "Claude is rate limiting this API key; try again shortly" };
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    return { status: error.status, message: `Claude returned an error (${error.status})` };
  }
  return { status: 502, message: "Couldn't reach Claude" };
}

/**
 * Stop the sessions of these runs, if they belong to the workspace agent.
 * Interrupting an idle session is harmless; nothing is archived or deleted.
 */
export async function interruptRunSessions(runIds: string[]) {
  if (!runIds.length) return;
  const runs = await db.agentRun.findMany({
    where: { id: { in: runIds }, externalSessionId: { not: null }, agent: { kind: "CLAUDE_API" } },
    select: { id: true, externalSessionId: true, agent: { select: { configEnc: true } } },
  });
  for (const run of runs) {
    try {
      const config = decryptConfig<ClaudeApiConfig>(run.agent.configEnc);
      await anthropicClient(config.apiKey).beta.sessions.events.send(run.externalSessionId!, {
        events: [{ type: "user.interrupt" }],
      });
    } catch (error) {
      console.error("[agents.interrupt]", run.id, describeAnthropicError(error).message);
    }
  }
}

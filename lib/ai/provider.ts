import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { anthropicClient } from "@/lib/agents/claude-api-client";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { badRequest, ServiceError } from "@/lib/services/errors";

/**
 * Who pays for in-app AI and how a request reaches Claude
 * (docs/features/20-in-app-ai.md "Who pays"): the workspace's own Claude API
 * key, else Kanso's platform key with a daily cap, else AI is off.
 */

export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const DEFAULT_AI_MODEL: AiModel = "claude-opus-5-5";

/** List prices in dollars per million tokens (input, output), for the spend estimate. */
const PRICES: Record<AiModel, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

const asModel = (value: string): AiModel => ((AI_MODELS as readonly string[]).includes(value) ? (value as AiModel) : DEFAULT_AI_MODEL);

export const platformApiKey = () => process.env.AI_PLATFORM_API_KEY || null;

export function platformDailyLimit() {
  const value = Number(process.env.AI_PLATFORM_DAILY_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : 50;
}

/** Today (UTC) as a date-only value. */
export const utcDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export type AiAvailability =
  | { available: true; source: "workspace" | "platform"; model: AiModel }
  | { available: false; reason: "off" | "no_key" };

type Resolved = { available: true; source: "workspace" | "platform"; model: AiModel; apiKey: string };

async function resolve(workspaceId: string): Promise<Resolved | Extract<AiAvailability, { available: false }>> {
  const settings = await db.aiSettings.findUnique({
    where: { workspaceId },
    select: { enabled: true, model: true, apiKeyEnc: true },
  });
  if (settings && !settings.enabled) return { available: false, reason: "off" };
  const model = asModel(settings?.model ?? DEFAULT_AI_MODEL);
  if (settings?.apiKeyEnc) return { available: true, source: "workspace", model, apiKey: decrypt(settings.apiKeyEnc) };
  const platform = platformApiKey();
  if (platform) return { available: true, source: "platform", model, apiKey: platform };
  return { available: false, reason: "no_key" };
}

/** Whether AI is on for a workspace, without the key. */
export async function aiAvailability(workspaceId: string): Promise<AiAvailability> {
  const resolved = await resolve(workspaceId);
  if (!resolved.available) return resolved;
  return { available: true, source: resolved.source, model: resolved.model };
}

/** Check a key with a cheap authenticated call. A rejected key is a 400. */
export async function checkApiKey(apiKey: string) {
  try {
    await anthropicClient(apiKey).models.list({ limit: 1 });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw badRequest("Claude rejected that API key");
    }
    throw aiError(error, "workspace");
  }
}

/** A safe message for an Anthropic failure: never the key, never a stack. */
function aiError(error: unknown, source: "workspace" | "platform") {
  if (error instanceof ServiceError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return source === "workspace"
      ? new ServiceError(502, "Claude rejected the workspace's API key. An admin can update it in Settings → AI.")
      : new ServiceError(502, "Kanso's AI isn't working right now. Try again later.", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) return new ServiceError(429, "Claude is busy right now. Try again in a minute.");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ServiceError(502, "Claude took too long to answer. Try again.");
  if (error instanceof Anthropic.APIConnectionError) return new ServiceError(502, "Couldn't reach Claude. Try again.");
  if (error instanceof Anthropic.APIError && (error.status === 529 || (error.status ?? 0) >= 500)) {
    return new ServiceError(502, "Claude is busy right now. Try again in a minute.");
  }
  if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
    // The answer didn't match the schema.
    return new ServiceError(502, "Claude's answer didn't come out right. Try again.");
  }
  if (error instanceof Anthropic.APIError) {
    console.error("[ai]", error.status, error.message.slice(0, 200));
    return new ServiceError(502, "Claude couldn't answer that. Try again.");
  }
  console.error("[ai]", error instanceof Error ? error.name : "error");
  return new ServiceError(502, "Couldn't reach Claude. Try again.");
}

async function recordUsage(
  workspaceId: string,
  source: "workspace" | "platform",
  model: AiModel,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null,
) {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const output = usage?.output_tokens ?? 0;
  const [inPrice, outPrice] = PRICES[model];
  const cost = (input * inPrice + output * outPrice) / 1_000_000;
  const day = utcDay();
  const platform = source === "platform" ? 1 : 0;
  await db.aiUsage.upsert({
    where: { workspaceId_day: { workspaceId, day } },
    create: { workspaceId, day, requests: 1, platformRequests: platform, inputTokens: input, outputTokens: output, costUsd: cost },
    update: {
      requests: { increment: 1 },
      platformRequests: { increment: platform },
      inputTokens: { increment: input },
      outputTokens: { increment: output },
      costUsd: { increment: cost },
    },
  });
}

/** The workspace's AI usage since the start of this month (UTC). */
export async function monthUsage(workspaceId: string, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const total = await db.aiUsage.aggregate({
    where: { workspaceId, day: { gte: from } },
    _sum: { requests: true, costUsd: true },
  });
  return { requests: total._sum.requests ?? 0, costUsd: Math.round((total._sum.costUsd ?? 0) * 100) / 100 };
}

export const AI_OFF = "AI is turned off for this workspace";
export const AI_NO_KEY = "AI isn't set up for this workspace. An admin can add a Claude API key in Settings → AI.";

/**
 * One structured request: Claude's answer parsed against `schema`. Throws a
 * ServiceError with a message safe to show.
 */
export async function generate<S extends z.ZodType>(
  workspaceId: string,
  request: { system: string; prompt: string; schema: S; maxTokens?: number },
): Promise<z.infer<S>> {
  const resolved = await resolve(workspaceId);
  if (!resolved.available) throw new ServiceError(409, resolved.reason === "off" ? AI_OFF : AI_NO_KEY);

  if (resolved.source === "platform") {
    const today = await db.aiUsage.findUnique({
      where: { workspaceId_day: { workspaceId, day: utcDay() } },
      select: { platformRequests: true },
    });
    if ((today?.platformRequests ?? 0) >= platformDailyLimit()) {
      throw new ServiceError(
        429,
        "This workspace has used today's AI requests. Try again tomorrow, or ask an admin to add the workspace's own Claude API key in Settings → AI.",
      );
    }
  }

  let message;
  try {
    message = await anthropicClient(resolved.apiKey).messages.parse(
      {
        model: resolved.model,
        max_tokens: request.maxTokens ?? 8000,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: { format: zodOutputFormat(request.schema), effort: "low" },
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    throw aiError(error, resolved.source);
  }
  await recordUsage(workspaceId, resolved.source, resolved.model, message.usage);

  if (message.stop_reason === "refusal") throw badRequest("Claude declined this request.");
  if (message.stop_reason === "max_tokens" || message.parsed_output == null) {
    throw new ServiceError(502, "Claude's answer was cut short. Try again.");
  }
  return message.parsed_output as z.infer<S>;
}

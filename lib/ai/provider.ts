import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import {
  APICallError,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from "ai";
import type { z } from "zod";

import { CATALOG, isProviderId, modelPrice, type ProviderId, providerLabel } from "@/lib/ai/catalog";
import { endpointFetch } from "@/lib/ai/endpoint";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { badRequest, ServiceError } from "@/lib/services/errors";

/**
 * Who pays for in-app AI and how a request reaches the model
 * (docs/features/24-multi-provider-ai.md): the workspace's own key for the
 * provider it picked, else Kanso's platform key with a daily cap, else AI is
 * off. Every provider goes through the AI SDK, so there is one call shape,
 * one usage format and one error mapper.
 */

/** What a request needs to reach a model. */
export type ModelTarget = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  structuredOutputs: boolean;
};

export const platformApiKey = () => process.env.AI_PLATFORM_API_KEY || null;

/** Kanso's own key: an Anthropic key unless AI_PLATFORM_PROVIDER names another catalog provider. */
function platformTarget(): ModelTarget | null {
  const apiKey = platformApiKey();
  if (!apiKey) return null;
  const raw = process.env.AI_PLATFORM_PROVIDER ?? "anthropic";
  const provider: ProviderId = isProviderId(raw) && raw !== "custom" ? raw : "anthropic";
  const model = process.env.AI_PLATFORM_MODEL || CATALOG[provider].defaultModel;
  return { provider, model, apiKey, baseUrl: null, structuredOutputs: true };
}

export function platformDailyLimit() {
  const value = Number(process.env.AI_PLATFORM_DAILY_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : 50;
}

/** Today (UTC) as a date-only value. */
export const utcDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export type AiAvailability =
  | { available: true; source: "workspace" | "platform"; provider: ProviderId; model: string }
  | { available: false; reason: "off" | "no_key" };

type Resolved = { available: true; source: "workspace" | "platform"; target: ModelTarget };

async function resolve(workspaceId: string): Promise<Resolved | Extract<AiAvailability, { available: false }>> {
  const settings = await db.aiSettings.findUnique({
    where: { workspaceId },
    select: { enabled: true, provider: true, model: true, apiKeyEnc: true, baseUrl: true, structuredOutputs: true },
  });
  if (settings && !settings.enabled) return { available: false, reason: "off" };
  if (settings?.apiKeyEnc && isProviderId(settings.provider)) {
    return {
      available: true,
      source: "workspace",
      target: {
        provider: settings.provider,
        model: settings.model,
        apiKey: decrypt(settings.apiKeyEnc),
        baseUrl: settings.baseUrl,
        structuredOutputs: settings.structuredOutputs,
      },
    };
  }
  const platform = platformTarget();
  if (platform) return { available: true, source: "platform", target: platform };
  return { available: false, reason: "no_key" };
}

/** Whether AI is on for a workspace, without the key. */
export async function aiAvailability(workspaceId: string): Promise<AiAvailability> {
  const resolved = await resolve(workspaceId);
  if (!resolved.available) return resolved;
  return { available: true, source: resolved.source, provider: resolved.target.provider, model: resolved.target.model };
}

// ---------------------------------------------------------------------------
// Models

type ModelFactory = (target: ModelTarget) => LanguageModel;
let factoryOverride: ModelFactory | null = null;

/** Tests swap in a mock model (ai/test); null restores the real providers. */
export function setAiModelFactory(next: ModelFactory | null) {
  factoryOverride = next;
}

/** A model client for one request; keys never live in module state. */
function languageModel(target: ModelTarget): LanguageModel {
  if (factoryOverride) return factoryOverride(target);
  const { apiKey, model } = target;
  switch (target.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "mistral":
      return createMistral({ apiKey })(model);
    case "xai":
      return createXai({ apiKey })(model);
    case "deepseek":
      return createDeepSeek({ apiKey })(model);
    case "groq":
      return createGroq({ apiKey })(model);
    case "custom": {
      if (!target.baseUrl) throw new ServiceError(409, "The custom AI endpoint has no base URL. An admin can set it in Settings → AI.");
      return createOpenAICompatible({
        name: "custom",
        baseURL: target.baseUrl,
        apiKey,
        fetch: endpointFetch(target.baseUrl),
        supportsStructuredOutputs: target.structuredOutputs,
      })(model);
    }
  }
}

/**
 * Low reasoning effort where the provider has a setting for it, as feature 20
 * did for Claude: answers come back quickly and cost less.
 */
type ProviderOptions = Parameters<typeof generateText>[0]["providerOptions"];

function lowEffort(provider: ProviderId): ProviderOptions {
  switch (provider) {
    case "anthropic":
      return { anthropic: { effort: "low" } };
    case "openai":
      return { openai: { reasoningEffort: "low" } };
    case "google":
      return { google: { thinkingConfig: { thinkingLevel: "low" } } };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Errors

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "");

/** Anything shaped like an API key or bearer token, as providers sometimes echo them back. */
const KEY_SHAPED = /\b(?:sk|xai|gsk|AIza|key|bearer)[-_ ]?[A-Za-z0-9_-]{12,}|\b[A-Za-z0-9_-]{32,}\b/gi;

/** A provider message safe for the server log: the key removed, then anything key-shaped, then cut short. */
function redact(message: string, apiKey?: string) {
  const withoutKey = apiKey ? message.split(apiKey).join("[key]") : message;
  return withoutKey.replace(KEY_SHAPED, "[redacted]").slice(0, 200);
}
const isTimeout = (error: unknown): boolean =>
  ["TimeoutError", "AbortError"].includes(nameOf(error)) || (error instanceof Error && error.cause !== error && isTimeout(error.cause));

/**
 * A safe message for a failed request, naming the provider: never the key,
 * never a stack, never the provider's raw message.
 */
export function aiError(
  error: unknown,
  provider: ProviderId,
  source: "workspace" | "platform",
  model?: string,
  apiKey?: string,
): ServiceError {
  if (error instanceof ServiceError) return error;
  const label = providerLabel(provider);
  if (RetryError.isInstance(error)) return aiError(error.lastError, provider, source, model, apiKey);

  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "length") return new ServiceError(502, `${label}'s answer was cut short. Try again.`);
    if (error.finishReason === "content-filter") return badRequest(`${label} declined this request.`);
    return new ServiceError(502, `${label}'s answer didn't come out right. Try again.`);
  }
  if (NoOutputGeneratedError.isInstance(error)) return new ServiceError(502, `${label}'s answer didn't come out right. Try again.`);
  if (isTimeout(error)) return new ServiceError(502, `${label} took too long to answer. Try again.`);

  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    if (status === 401 || status === 403) {
      if (source === "platform") {
        console.error("[ai] platform key rejected", provider, status);
        return new ServiceError(502, "Kanso's AI isn't working right now. Try again later.");
      }
      return new ServiceError(502, `${label} rejected the workspace's API key. An admin can update it in Settings → AI.`);
    }
    if (status === 429 || status === 529 || status >= 500) return new ServiceError(429, `${label} is busy right now. Try again in a minute.`);
    if (status === 404) {
      return new ServiceError(502, `${label} couldn't find the model${model ? ` "${model}"` : ""}. An admin can pick another in Settings → AI.`);
    }
    if (!status) return new ServiceError(502, `Couldn't reach ${label}. Try again.`);
    console.error("[ai]", provider, status, redact(error.message, apiKey));
    return new ServiceError(502, `${label} couldn't answer that. Try again.`);
  }
  // fetch failures (DNS, refused connection, a blocked custom endpoint) arrive as TypeErrors.
  console.error("[ai]", provider, nameOf(error) || "error");
  return new ServiceError(502, `Couldn't reach ${label}. Try again.`);
}

// ---------------------------------------------------------------------------
// Usage

async function recordUsage(workspaceId: string, source: "workspace" | "platform", target: ModelTarget, usage: LanguageModelUsage | undefined) {
  // inputTokens includes cached tokens.
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const price = modelPrice(target.provider, target.model);
  const cost = price ? (input * price[0] + output * price[1]) / 1_000_000 : 0;
  const day = utcDay();
  const platform = source === "platform" ? 1 : 0;
  const unpriced = price ? 0 : 1;
  await db.aiUsage.upsert({
    where: { workspaceId_day: { workspaceId, day } },
    create: { workspaceId, day, requests: 1, platformRequests: platform, inputTokens: input, outputTokens: output, costUsd: cost, unpricedRequests: unpriced },
    update: {
      requests: { increment: 1 },
      platformRequests: { increment: platform },
      inputTokens: { increment: input },
      outputTokens: { increment: output },
      costUsd: { increment: cost },
      unpricedRequests: { increment: unpriced },
    },
  });
}

/** The workspace's AI usage since the start of this month (UTC). */
export async function monthUsage(workspaceId: string, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const total = await db.aiUsage.aggregate({
    where: { workspaceId, day: { gte: from } },
    _sum: { requests: true, costUsd: true, unpricedRequests: true },
  });
  return {
    requests: total._sum.requests ?? 0,
    costUsd: Math.round((total._sum.costUsd ?? 0) * 100) / 100,
    unpricedRequests: total._sum.unpricedRequests ?? 0,
  };
}

export const AI_OFF = "AI is turned off for this workspace";
export const AI_NO_KEY = "AI isn't set up for this workspace. An admin can add an API key in Settings → AI.";

// ---------------------------------------------------------------------------
// Requests

/**
 * Check a key, model and (custom) base URL together with one tiny request
 * (docs/features/24-multi-provider-ai.md "Checking a key"). Throws a 400 the
 * admin can act on, or a 429/502 when the provider is having trouble.
 */
export async function checkConnection(target: ModelTarget) {
  const label = providerLabel(target.provider);
  try {
    await generateText({
      model: languageModel(target),
      prompt: "Reply with the word OK.",
      maxOutputTokens: 16,
      providerOptions: lowEffort(target.provider),
      maxRetries: 0,
      timeout: 20_000,
    });
  } catch (error) {
    const cause = RetryError.isInstance(error) ? error.lastError : error;
    if (APICallError.isInstance(cause)) {
      const status = cause.statusCode ?? 0;
      if (status === 401 || status === 403) throw badRequest(`${label} rejected that API key`);
      if (status === 404 || (status === 400 && /model/i.test(cause.message))) {
        throw badRequest(`${label} doesn't have a model called "${target.model}"`);
      }
    }
    if (target.provider === "custom" && !APICallError.isInstance(cause) && !isTimeout(cause)) {
      throw badRequest("Kanso couldn't reach that URL. Check it's the API's base URL (often ending in /v1) and that it's public.");
    }
    throw aiError(error, target.provider, "workspace", target.model, target.apiKey);
  }
}

/**
 * One structured request: the model's answer parsed against `schema`. Throws
 * a ServiceError with a message safe to show.
 */
export async function generate<S extends z.ZodType>(
  workspaceId: string,
  request: { system: string; prompt: string; schema: S; maxTokens?: number },
): Promise<z.infer<S>> {
  const resolved = await resolve(workspaceId);
  if (!resolved.available) throw new ServiceError(409, resolved.reason === "off" ? AI_OFF : AI_NO_KEY);
  const { target, source } = resolved;

  if (source === "platform") {
    const today = await db.aiUsage.findUnique({
      where: { workspaceId_day: { workspaceId, day: utcDay() } },
      select: { platformRequests: true },
    });
    if ((today?.platformRequests ?? 0) >= platformDailyLimit()) {
      throw new ServiceError(
        429,
        "This workspace has used today's AI requests. Try again tomorrow, or ask an admin to add the workspace's own API key in Settings → AI.",
      );
    }
  }

  let result;
  try {
    result = await generateText({
      model: languageModel(target),
      system: request.system,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema }),
      maxOutputTokens: request.maxTokens ?? 8000,
      providerOptions: lowEffort(target.provider),
      timeout: 60_000,
      maxRetries: 1,
    });
  } catch (error) {
    // A failed parse still used tokens.
    if (NoObjectGeneratedError.isInstance(error)) await recordUsage(workspaceId, source, target, error.usage);
    throw aiError(error, target.provider, source, target.model, target.apiKey);
  }
  await recordUsage(workspaceId, source, target, result.usage);

  const label = providerLabel(target.provider);
  if (result.finishReason === "content-filter") throw badRequest(`${label} declined this request.`);
  if (result.finishReason === "length") throw new ServiceError(502, `${label}'s answer was cut short. Try again.`);
  try {
    return result.output as z.infer<S>;
  } catch (error) {
    throw aiError(error, target.provider, source, target.model, target.apiKey);
  }
}

import OpenAI from "openai";

/**
 * The OpenAI client for the workspace agent on the Agents API
 * (docs/features/25-workspace-agent-openai.md), built per call from the
 * workspace's own API key. Swappable so tests run against a fake.
 */

type Factory = (apiKey: string) => OpenAI;
const defaultFactory: Factory = (apiKey) => new OpenAI({ apiKey, maxRetries: 2, timeout: 30_000 });
let factory: Factory = defaultFactory;

export function setOpenAiClientFactory(next: Factory | null) {
  factory = next ?? defaultFactory;
}

export const openaiClient = (apiKey: string) => factory(apiKey);

/** A short, safe description of an OpenAI API failure (never the key, never a stack). */
export function describeOpenAiError(error: unknown): { status: number; message: string } {
  if (error instanceof OpenAI.AuthenticationError) return { status: 401, message: "OpenAI rejected the API key" };
  if (error instanceof OpenAI.PermissionDeniedError) {
    return { status: 403, message: "That API key's project isn't allowed to use the Agents API and vaults" };
  }
  if (error instanceof OpenAI.RateLimitError) return { status: 429, message: "OpenAI is rate limiting this API key; try again shortly" };
  if (error instanceof OpenAI.APIError && typeof error.status === "number") {
    return { status: error.status, message: `OpenAI returned an error (${error.status})` };
  }
  return { status: 502, message: "Couldn't reach OpenAI" };
}

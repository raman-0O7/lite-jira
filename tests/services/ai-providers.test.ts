import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG, PROVIDER_IDS } from "@/lib/ai/catalog";
import { normalizeEndpointUrl, setEndpointFetch } from "@/lib/ai/endpoint";
import { type ModelTarget, setAiModelFactory, utcDay } from "@/lib/ai/provider";
import { encryptConfig } from "@/lib/agents/config";
import { db } from "@/lib/db";
import { askProject, getAi, testAiSettings, updateAiSettings } from "@/lib/services/ai";

import { makeTeam } from "../factories";
import { makeProject } from "../helpers";

/** docs/features/24-multi-provider-ai.md */

const OPENAI_KEY = "sk-proj-openai-test-key-0123456789abcdOPEN";
const DEEPSEEK_KEY = "sk-deepseek-test-key-0123456789abcdSEEK";
const CUSTOM_KEY = "or-custom-endpoint-key-0123456789CUST";

let ai: { calls: { target: ModelTarget; providerOptions: unknown }[]; checks: ModelTarget[]; reply: unknown; failWith: unknown; finish: "stop" | "length" };

const apiError = (statusCode: number, message = "error") =>
  new APICallError({ message, url: "https://api.example/v1", requestBodyValues: {}, statusCode, isRetryable: false });

function fakeModel(target: ModelTarget) {
  return new MockLanguageModelV4({
    provider: target.provider,
    modelId: target.model,
    doGenerate: async (options) => {
      if (ai.failWith) throw ai.failWith;
      const structured = options.responseFormat?.type === "json";
      if (structured) ai.calls.push({ target, providerOptions: options.providerOptions });
      else ai.checks.push(target);
      return {
        content: [{ type: "text", text: structured ? (ai.finish === "stop" ? JSON.stringify(ai.reply) : '{"answer":') : "OK" }],
        finishReason: { unified: ai.finish, raw: undefined },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 500, text: 500, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

beforeAll(() => setAiModelFactory(fakeModel));
afterAll(() => setAiModelFactory(null));
beforeEach(() => {
  ai = { calls: [], checks: [], reply: { answer: "ok" }, failWith: null, finish: "stop" };
});
afterEach(() => {
  setEndpointFetch(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function team() {
  const { ctx: owner, workspace, user } = await makeTeam();
  const { project } = await makeProject(owner);
  return { owner, workspace, user, project };
}

describe("catalog", () => {
  it("has a default model in each provider's list, unique ids, and only the custom endpoint without models", () => {
    for (const id of PROVIDER_IDS) {
      const entry = CATALOG[id];
      expect(entry.id).toBe(id);
      const ids = entry.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      if (id === "custom") expect(ids).toEqual([]);
      else expect(ids).toContain(entry.defaultModel);
    }
  });
});

describe("choosing a provider", () => {
  it("switches provider with its key, the default model, and a check first", async () => {
    const { owner } = await team();
    await expect(updateAiSettings(owner, { provider: "openai" })).rejects.toMatchObject({ status: 400, message: "Paste an API key for OpenAI" });

    const saved = await updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY });
    expect(ai.checks).toEqual([expect.objectContaining({ provider: "openai", model: "gpt-6.1-sol", apiKey: OPENAI_KEY })]);
    expect(saved.settings).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", apiKeyHint: "…OPEN", source: "workspace" });
    expect(saved.ai.providerLabel).toBe("OpenAI");
    expect(JSON.stringify(saved)).not.toContain(OPENAI_KEY);
  });

  it("accepts any model id the provider has, and saves nothing when the check fails", async () => {
    const { owner } = await team();
    await updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY, model: "gpt-6.2-astra" });
    expect(ai.checks.at(-1)).toMatchObject({ model: "gpt-6.2-astra" });

    ai.failWith = apiError(404, "The model `gpt-nope` does not exist");
    await expect(updateAiSettings(owner, { model: "gpt-nope" })).rejects.toMatchObject({
      status: 400,
      message: 'OpenAI doesn\'t have a model called "gpt-nope"',
    });
    expect((await db.aiSettings.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } })).model).toBe("gpt-6.2-astra");
    await expect(updateAiSettings(owner, { model: "not a model id!" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("only takes a base URL for a custom endpoint, and the agent's key only for Anthropic", async () => {
    const { owner, user } = await team();
    await expect(updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY, baseUrl: "https://example.com/v1" })).rejects.toMatchObject({
      message: "Only a custom endpoint takes a base URL",
    });
    await expect(updateAiSettings(owner, { provider: "custom", apiKey: CUSTOM_KEY, model: "m" })).rejects.toMatchObject({
      message: "Enter the endpoint's base URL",
    });
    await db.agent.create({
      data: { workspaceId: owner.workspaceId, name: "Workspace agent", kind: "CLAUDE_API", ownerUserId: user.id, configEnc: encryptConfig({ apiKey: "sk-ant-x" } as never) },
    });
    await expect(updateAiSettings(owner, { provider: "openai", useAgentKey: true })).rejects.toMatchObject({
      message: "The workspace agent's key only works with Anthropic",
    });
  });

  it("tests a connection without saving", async () => {
    const { owner } = await team();
    expect(await testAiSettings(owner, { provider: "deepseek", apiKey: DEEPSEEK_KEY })).toEqual({ ok: true });
    expect(ai.checks).toEqual([expect.objectContaining({ provider: "deepseek", model: "deepseek-v4-pro" })]);
    expect(await db.aiSettings.count()).toBe(0);
    await expect(testAiSettings(owner, {})).rejects.toMatchObject({ message: "Paste an API key to test" });
  });
});

describe("requests and errors", () => {
  it("asks each provider for low reasoning effort where it has the setting", async () => {
    const { owner, project } = await team();
    await updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY });
    await askProject(owner, project.id, { question: "?" });
    expect(ai.calls.at(-1)!.providerOptions).toMatchObject({ openai: { reasoningEffort: "low" } });

    await updateAiSettings(owner, { provider: "google", apiKey: "AIzaSyGoogleTestKey0123456789abcdefGOOG" });
    await askProject(owner, project.id, { question: "?" });
    expect(ai.calls.at(-1)!.providerOptions).toMatchObject({ google: { thinkingConfig: { thinkingLevel: "low" } } });
  });

  it("names the chosen provider in every error, and never shows or logs the key", async () => {
    const { owner, project } = await team();
    await updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ask = () => askProject(owner, project.id, { question: "?" });

    const cases: [unknown, number, string][] = [
      [apiError(401, `bad key ${OPENAI_KEY}`), 502, "OpenAI rejected the workspace's API key. An admin can update it in Settings → AI."],
      [apiError(429), 429, "OpenAI is busy right now. Try again in a minute."],
      [apiError(503), 429, "OpenAI is busy right now. Try again in a minute."],
      [apiError(404), 502, 'OpenAI couldn\'t find the model "gpt-6.1-sol". An admin can pick another in Settings → AI.'],
      [apiError(400, `odd request with ${OPENAI_KEY}`), 502, "OpenAI couldn't answer that. Try again."],
      [Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }), 502, "OpenAI took too long to answer. Try again."],
      [new TypeError("fetch failed"), 502, "Couldn't reach OpenAI. Try again."],
    ];
    for (const [error, status, message] of cases) {
      ai.failWith = error;
      await expect(ask()).rejects.toMatchObject({ status, message });
    }
    ai.failWith = null;
    ai.finish = "length";
    await expect(ask()).rejects.toMatchObject({ status: 502, message: "OpenAI's answer was cut short. Try again." });

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(OPENAI_KEY.slice(8));
    expect(logged).toContain("odd request with [key]");
  });

  it("estimates cost for catalog prices and counts unpriced requests separately", async () => {
    const { owner, project } = await team();
    await updateAiSettings(owner, { provider: "openai", apiKey: OPENAI_KEY });
    await askProject(owner, project.id, { question: "?" });
    // gpt-6.1-sol at $2 / $10 per million: 1000 in, 500 out.
    let usage = await db.aiUsage.findUniqueOrThrow({ where: { workspaceId_day: { workspaceId: owner.workspaceId, day: utcDay() } } });
    expect(usage.costUsd).toBeCloseTo(0.007, 6);
    expect(usage.unpricedRequests).toBe(0);

    await updateAiSettings(owner, { provider: "deepseek", apiKey: DEEPSEEK_KEY });
    await askProject(owner, project.id, { question: "?" });
    usage = await db.aiUsage.findUniqueOrThrow({ where: { workspaceId_day: { workspaceId: owner.workspaceId, day: utcDay() } } });
    expect(usage).toMatchObject({ requests: 2, unpricedRequests: 1 });
    expect(usage.costUsd).toBeCloseTo(0.007, 6);
    expect((await getAi(owner)).settings?.usage).toEqual({ requests: 2, costUsd: 0.01, unpricedRequests: 1 });
  });

  it("points Kanso's platform key at another provider with environment variables", async () => {
    vi.stubEnv("AI_PLATFORM_API_KEY", "platform-openai-key-0123456789");
    vi.stubEnv("AI_PLATFORM_PROVIDER", "openai");
    const { owner, project } = await team();
    await askProject(owner, project.id, { question: "?" });
    expect(ai.calls[0]!.target).toMatchObject({ provider: "openai", model: "gpt-6.1-sol" });
    expect((await getAi(owner)).settings?.platform).toMatchObject({ providerLabel: "OpenAI", model: "gpt-6.1-sol" });
  });
});

describe("custom endpoints", () => {
  it("only allows https on a public host (http://localhost outside production)", () => {
    expect(normalizeEndpointUrl("https://openrouter.ai/api/v1/?x=1#y")).toBe("https://openrouter.ai/api/v1");
    for (const [url, message] of [
      ["ftp://example.com", "The base URL must use https"],
      ["http://example.com/v1", "The base URL must use https"],
      ["https://10.0.0.5/v1", "The base URL must be a public host"],
      ["https://169.254.169.254/latest", "The base URL must be a public host"],
      ["https://[::1]/v1", "The base URL must be a public host"],
      ["https://[fd00::1]/v1", "The base URL must be a public host"],
      ["https://models.internal/v1", "The base URL must be a public host"],
      ["https://user:pass@example.com/v1", "Put the key in the API key field, not in the URL"],
      ["not a url", "That base URL isn't a valid URL"],
    ] as const) {
      expect(() => normalizeEndpointUrl(url)).toThrow(message);
    }
    expect(normalizeEndpointUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => normalizeEndpointUrl("http://localhost:11434/v1")).toThrow("The base URL must use https");
  });

  it("talks to an OpenAI-compatible API, with and without structured outputs", async () => {
    setAiModelFactory(null);
    try {
      const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
      setEndpointFetch(async (input, init) => {
        const body = JSON.parse(String(init?.body));
        sent.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body });
        const content = body.response_format ? JSON.stringify({ answer: "From the gateway." }) : "OK";
        return new Response(
          JSON.stringify({
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      const { owner, project } = await team();
      await updateAiSettings(owner, { provider: "custom", apiKey: CUSTOM_KEY, baseUrl: "https://gateway.example.com/v1/", model: "acme/model-1" });
      expect(sent[0]).toMatchObject({ url: "https://gateway.example.com/v1/chat/completions", auth: `Bearer ${CUSTOM_KEY}` });

      expect(await askProject(owner, project.id, { question: "?" })).toEqual({ answer: "From the gateway." });
      expect((sent.at(-1)!.body.response_format as { type: string }).type).toBe("json_schema");

      await updateAiSettings(owner, { structuredOutputs: false });
      expect(await askProject(owner, project.id, { question: "?" })).toEqual({ answer: "From the gateway." });
      expect((sent.at(-1)!.body.response_format as { type: string }).type).not.toBe("json_schema");

      // An unpriced model: tokens only.
      const usage = await db.aiUsage.findUniqueOrThrow({ where: { workspaceId_day: { workspaceId: owner.workspaceId, day: utcDay() } } });
      expect(usage).toMatchObject({ unpricedRequests: 2, costUsd: 0 });
    } finally {
      setAiModelFactory(fakeModel);
    }
  });

  it("explains an unreachable endpoint", async () => {
    setAiModelFactory(null);
    try {
      setEndpointFetch(async () => {
        throw new TypeError("fetch failed");
      });
      const { owner } = await team();
      await expect(
        updateAiSettings(owner, { provider: "custom", apiKey: CUSTOM_KEY, baseUrl: "https://gateway.example.com/v1", model: "m" }),
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Kanso couldn't reach that URL") });
      expect(await db.aiSettings.count()).toBe(0);
    } finally {
      setAiModelFactory(fakeModel);
    }
  });
});

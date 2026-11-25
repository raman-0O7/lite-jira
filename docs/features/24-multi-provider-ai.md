# Feature 24 — In-app AI on any provider

**Depends on 20.**

## Goal
In-app AI (feature 20: Fill in, Break down, Triage, Summarize, Ask) runs only
on Claude today. A workspace that already pays OpenAI, Google or another
provider has to open a second account to use it. Kanso shouldn't be tied to one
provider.

This feature lets an admin pick **which provider and model** the workspace's
in-app AI uses, with the workspace's own API key for that provider. The five
features, the rule that AI only suggests, and the permissions stay exactly as
in feature 20.

We do it with the **AI SDK** (`ai`, v7) and its provider packages, not with
one hand-written client per provider: one call shape, structured output against
the same Zod schemas, one usage format, one error type.

## Providers

| Provider | Package | Key from | Notes |
|---|---|---|---|
| **Anthropic** (default) | `@ai-sdk/anthropic` | Claude Console | Today's behaviour. The only one the workspace agent's key can be reused for |
| **OpenAI** | `@ai-sdk/openai` | OpenAI Platform | Responses API |
| **Google Gemini** | `@ai-sdk/google` | Google AI Studio | Gemini API key (not Vertex) |
| **Mistral** | `@ai-sdk/mistral` | Mistral console | |
| **xAI** | `@ai-sdk/xai` | xAI console | |
| **DeepSeek** | `@ai-sdk/deepseek` | DeepSeek platform | |
| **Groq** | `@ai-sdk/groq` | GroqCloud console | |
| **Custom (OpenAI-compatible)** | `@ai-sdk/openai-compatible` | Wherever the endpoint lives | Base URL + key: OpenRouter, Together, Fireworks, a company gateway… |

Not in this feature: Amazon Bedrock, Azure OpenAI, Google Vertex (cloud
credentials rather than one key; later, as separate providers), Vercel AI
Gateway (billed through Vercel rather than the workspace's own account;
possible later as one more provider), and Sign in with ChatGPT (needs
OpenAI's approval; separate feature).

Pin exact package versions in `package.json` (AGENTS.md: versions differ from
training data — read the installed package's docs before writing code).

### The catalog (`lib/ai/catalog.ts`)
One entry per provider, the only place provider facts live:

```ts
type ProviderEntry = {
  id: "anthropic" | "openai" | "google" | "mistral" | "xai" | "deepseek" | "groq" | "custom";
  label: string;                 // "OpenAI", shown in Settings and in error messages
  keyUrl: string | null;         // where to create a key
  keyPattern?: RegExp;           // light format check before calling the provider
  models: { id: string; label: string; note?: string; price?: [inPerM: number, outPerM: number] }[];
  defaultModel: string;
  reasoning?: (effort: "low") => ProviderOptions;   // see "Requests"
};
```

- **Models are curated**, a few per provider (best, balanced, fastest), with
  list prices for the spend estimate. Model ids and prices are checked against
  each provider's docs when built and when bumped; nothing is guessed.
- **"Other model…"** lets an admin type any model id the provider accepts
  (for new models before Kanso's catalog catches up, and for every Custom
  endpoint). Saving checks it with a test call (see "Checking a key").
- **No price → no cost.** A model with no catalog price records tokens only;
  usage shows "cost unknown" for it instead of a made-up number.

## Who pays (replaces feature 20 "Who pays")
1. **The workspace's own key** for the chosen provider.
2. **Kanso's platform key**, when the server sets `AI_PLATFORM_API_KEY`
   (unchanged: daily cap, `AI_PLATFORM_DAILY_LIMIT`). It's an Anthropic key by
   default; `AI_PLATFORM_PROVIDER` and `AI_PLATFORM_MODEL` can point it at
   another catalog provider. A workspace on the platform key uses the
   platform's provider and model, whatever it has picked, and Settings → AI
   says so.
3. Neither: AI is off, as now.

## Settings → AI (admins)

```
Provider    [ OpenAI            ▾ ]
API key     [ sk-…•••• 4f2a ] [Replace] [Remove]      Get a key at platform.openai.com ↗
Model       [ GPT … (balanced) ▾ ]   (… Other model…)
Base URL    [ https://openrouter.ai/api/v1 ]           ← Custom only
            [x] The endpoint supports structured outputs (JSON schema)   ← Custom only
            [ Test connection ]
AI is on for the workspace   [ on ]
This month: 412 requests · ~$3.80 (estimate)
Issue text and comments are sent to OpenAI when someone uses AI.
```

- **Changing provider clears the key.** A key belongs to one provider; the
  admin pastes the new provider's key in the same save. The old key is
  deleted, not kept around.
- **"Use the workspace agent's key"** (feature 20) shows only when the provider
  is Anthropic.
- **The data note** names the provider, so the admin knows where issue text
  goes.
- **Test connection** runs the same check as saving, without saving.

## Checking a key
Saving (and Test connection) makes one tiny request with the chosen model:
`generateText` with a fixed one-word prompt and `maxOutputTokens: 16`. It
checks the key, the model id and (for Custom) the base URL together, for a
fraction of a cent. Results:

| Outcome | Shown |
|---|---|
| 401 / 403 | "OpenAI rejected that API key" (400) |
| 404, or the provider says the model doesn't exist | "OpenAI doesn't have a model called `x`" (400) |
| Custom: unreachable, not HTTPS, private address | "Kanso couldn't reach that URL" / the URL rule (400) |
| 429 / 5xx / timeout | "OpenAI is busy right now. Try again in a minute." (502); nothing is saved |

## Requests (`lib/ai/provider.ts`)
`generate(workspaceId, { system, prompt, schema, maxTokens })` keeps its
signature, so `lib/services/ai.ts` and the five features don't change. Inside:

```ts
const { output, usage, finishReason } = await generateText({
  model,                                  // catalog provider + model, with the resolved key
  system, prompt,
  output: Output.object({ schema }),
  maxOutputTokens: maxTokens ?? 8000,
  providerOptions: entry.reasoning?.("low"),   // e.g. Anthropic effort, OpenAI reasoning effort, Gemini thinking level
  abortSignal: AbortSignal.timeout(60_000),
  maxRetries: 1,
});
```

- **Low reasoning effort** where the provider has a knob for it, as feature 20
  did for Claude; omitted where it doesn't.
- **Custom endpoints** with structured outputs off use the SDK's JSON-mode
  fallback, and the answer is still parsed against the Zod schema; an answer
  that doesn't parse is the usual "didn't come out right" error.
- **Clients are built per request** from the resolved key; keys never live in
  module state.
- `lib/agents/*` keeps the Anthropic SDK: the workspace agent (Claude Managed
  Agents) isn't something the AI SDK wraps. Only `lib/ai/*` moves.

### Errors (replaces feature 20's Claude-only messages)
One mapper over the AI SDK's error types, with the provider's label in place of
"Claude", and the same rule: never the key, never a stack, never the raw
provider message.

| Cause | Message |
|---|---|
| `APICallError` 401 / 403, workspace key | "OpenAI rejected the workspace's API key. An admin can update it in Settings → AI." |
| Same, platform key | "Kanso's AI isn't working right now. Try again later." (logged for us) |
| 429, 529, 5xx | "OpenAI is busy right now. Try again in a minute." |
| Timeout / abort | "OpenAI took too long to answer. Try again." |
| Network error | "Couldn't reach OpenAI. Try again." |
| `finishReason: "content-filter"` | "OpenAI declined this request." |
| `finishReason: "length"` | "OpenAI's answer was cut short. Try again." |
| `NoObjectGeneratedError` (answer didn't match the schema) | "OpenAI's answer didn't come out right. Try again." |
| Anything else | "OpenAI couldn't answer that. Try again." (status and a 200-character excerpt logged, no key) |

### Usage
`recordUsage` reads the SDK's normalized `usage` (input, output, cached
tokens) and the catalog price for the model. Prices are per model, so a
workspace that changes provider mid-month gets a correct month total.

## Custom endpoints: the URL rule
A base URL is something Kanso's server will call, so it gets the same treatment
as outbound webhook URLs (`assertWebhookUrl`, feature 12):

- `https://` only, on a public host. `http://localhost` is allowed outside
  production, for local model servers during development.
- **Checked again at request time against the resolved address**, not just
  the hostname at save: a custom `fetch` for this provider resolves the host
  and refuses private, loopback and link-local addresses, so a DNS change
  after saving can't point Kanso at internal services.
- No redirects followed.
- The URL is stored as typed (not secret) and shown to admins; the key is
  encrypted like every other.

## Data
```prisma
model AiSettings {
  workspaceId       String  @id
  enabled           Boolean @default(true)
  provider          String  @default("anthropic")   // catalog id
  model             String  @default("claude-opus-5-5")
  baseUrl           String?                         // custom only
  structuredOutputs Boolean @default(true)          // custom only
  apiKeyEnc         String?
  apiKeyHint        String?
  …
}
model AiUsage {          // unchanged, except:
  costUsd     Float      // sum of known costs
  unpricedRequests Int @default(0)   // requests on a model with no catalog price
  …
}
```

Migration: existing rows get `provider = "anthropic"`; nothing else moves.
`provider` and `model` are validated against the catalog in the service (Zod),
not as a database enum, so adding a provider needs no migration.

## API
`GET /api/workspaces/[slug]/ai` adds `provider`, `providerLabel`, `baseUrl`,
`structuredOutputs`, and the catalog's providers and models (ids, labels,
whether priced) for the settings form.

`PUT /api/workspaces/[slug]/ai` (admins) accepts
`{ provider?, apiKey?, model?, baseUrl?, structuredOutputs?, enabled?, useAgentKey? }`:

- `provider` changing → `apiKey` required in the same request (400 otherwise:
  "Paste an API key for Mistral").
- `baseUrl` is required for `custom` and refused for others.
- `useAgentKey` only with `provider: "anthropic"`.
- Any change to provider, key, model or base URL runs the key check first;
  nothing is saved if it fails.

`POST /api/workspaces/[slug]/ai/test` (admins): the same body, runs the check,
saves nothing.

The five AI routes don't change.

## Rules (unchanged from feature 20, restated)
- Members and up use AI, in the web app; guests, API tokens and agents can't.
- Admins (`workspace.update`) manage Settings → AI and see usage.
- Imported GitHub text stays wrapped in `<untrusted>` tags; output is parsed
  against a schema; assignee and label ids not in what Kanso sent are dropped;
  nothing is written without the person.

## Tests (Vitest)
- Catalog: every provider has a default model in its model list; ids are
  unique.
- Settings service: provider change without a key is refused; `baseUrl` only
  for custom; `useAgentKey` only for Anthropic; members can't update; a failed
  key check saves nothing. The provider call is mocked at the `generateText`
  boundary.
- Error mapper: each row of the errors table, with a non-Anthropic label; the
  key never appears in a message or a log line.
- URL rule: private, loopback, link-local and IPv6-private addresses refused,
  by hostname and by resolved address; `http://localhost` only outside
  production.
- Usage: a priced model adds cost; an unpriced one adds `unpricedRequests` and
  no cost.
- The existing feature 20 service tests pass unchanged.

## Acceptance
- An admin picks OpenAI, pastes a valid key, picks a model, saves: Fill in,
  Break down, Triage, Summarize and Ask all work for members, with the same
  suggestion-then-accept flow as on Claude.
- The same with Google Gemini and with a Custom endpoint (OpenRouter), with
  structured outputs on and off.
- A wrong key, a wrong model id or a private base URL is refused at save with
  the message from "Checking a key", and nothing is saved.
- Switching provider clears the old key; the old provider is never called
  again.
- Errors name the chosen provider, never "Claude" when it isn't Claude.
- Usage shows an estimated cost for catalog models and "cost unknown" for
  others.
- Existing workspaces keep working on Anthropic with no admin action.
- The key never appears in a response, the page or the logs.
- `pnpm lint`, `tsc --noEmit`, `pnpm test` and `pnpm build` are clean.

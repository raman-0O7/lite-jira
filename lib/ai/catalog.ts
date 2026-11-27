/**
 * The providers in-app AI can use, and the facts Kanso needs about each
 * (docs/features/24-multi-provider-ai.md "The catalog"). The only place
 * provider facts live; shared by the server and the settings page, so it
 * imports no SDK.
 *
 * Model ids come from each AI SDK provider package's model table (versions
 * pinned in package.json). Prices are list prices in dollars per million
 * tokens (input, output) from each provider's own pricing page, checked on
 * 27 November 2026. A model without a price records tokens only ("cost
 * unknown"), never a guessed number.
 */

export const PROVIDER_IDS = ["anthropic", "openai", "google", "mistral", "xai", "deepseek", "groq", "custom"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type CatalogModel = {
  id: string;
  label: string;
  note?: string;
  /** Dollars per million tokens: [input, output]. */
  price?: [number, number];
};

export type ProviderEntry = {
  id: ProviderId;
  label: string;
  /** Where an admin creates a key. */
  keyUrl: string | null;
  keyPlaceholder: string;
  /**
   * A format check before calling the provider, only where the format is
   * documented and stable. Elsewhere the test request is the check.
   */
  keyPattern?: RegExp;
  models: CatalogModel[];
  defaultModel: string;
};

export const CATALOG: Record<ProviderId, ProviderEntry> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Best results", price: [4, 20] },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Balanced", price: [2, 10] },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest", price: [0.1, 0.5] },
    ],
    defaultModel: "claude-opus-5-5",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra", note: "Best results", price: [10, 50] },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", note: "Balanced", price: [2, 10] },
      { id: "gpt-6-luna", label: "GPT-6 Luna", note: "Fastest and cheapest", price: [0.1, 0.5] },
    ],
    defaultModel: "gpt-6.1-sol",
  },
  google: {
    id: "google",
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    models: [
      // Introductory $2/$10 until 30 Nov 2026; priced at the standard rate from 1 Dec.
      { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "Best results", price: [4, 20] },
      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", note: "Fast", price: [1.5, 7.5] },
    ],
    defaultModel: "gemini-4-argon",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "Mistral API key",
    models: [
      { id: "mistral-medium-latest", label: "Mistral Medium", note: "Mistral’s pick for most tasks", price: [1.5, 7.5] },
      { id: "mistral-large-latest", label: "Mistral Large", note: "Balanced", price: [0.5, 1.5] },
      { id: "mistral-small-latest", label: "Mistral Small", note: "Fastest and cheapest", price: [0.15, 0.6] },
    ],
    defaultModel: "mistral-medium-latest",
  },
  xai: {
    id: "xai",
    label: "xAI",
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    models: [{ id: "grok-4.7", label: "Grok 4.7", note: "Flagship", price: [2, 6] }],
    defaultModel: "grok-4.7",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
    // DeepSeek's prices change with the time of day, so Kanso shows tokens only.
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", note: "Best results" },
      { id: "deepseek-flash", label: "DeepSeek Flash", note: "Fastest and cheapest" },
    ],
    defaultModel: "deepseek-v4-pro",
  },
  groq: {
    id: "groq",
    label: "Groq",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    // Prices aren't published on a page Kanso could check; tokens only.
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "Best results" },
      { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", note: "Fast" },
    ],
    defaultModel: "openai/gpt-oss-120b",
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    keyUrl: null,
    keyPlaceholder: "The endpoint’s API key",
    // Any endpoint: OpenRouter, Together, a company gateway…; the model id is typed in.
    models: [],
    defaultModel: "",
  },
};

export const providerLabel = (id: ProviderId) => CATALOG[id].label;

export const isProviderId = (value: string): value is ProviderId => (PROVIDER_IDS as readonly string[]).includes(value);

/** The catalog price of a model, if Kanso knows it. */
export const modelPrice = (provider: ProviderId, model: string) =>
  CATALOG[provider].models.find((m) => m.id === model)?.price ?? null;

/** Model ids: letters, digits and the usual separators, like "openai/gpt-oss-120b" or "gpt-6.1-sol". */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

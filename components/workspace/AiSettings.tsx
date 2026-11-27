"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, PlugZap, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAiStatus } from "@/components/ai/use-ai";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CATALOG, PROVIDER_IDS, type ProviderId } from "@/lib/ai/catalog";
import { type AiSettingsPatch, type AiStatus, aiKeys, testAi, updateAi } from "@/lib/api/ai";
import { cn } from "@/lib/utils";

const OTHER = "__other__";

/**
 * Settings → AI (admins): which provider and model in-app AI uses, with the
 * workspace's own key, and the on/off switch
 * (docs/features/24-multi-provider-ai.md "Settings → AI").
 */
export function AiSettings() {
  const isAdmin = useCan("workspace.update");
  const status = useAiStatus();

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Only admins can change the workspace’s AI settings.</p>;
  }
  const settings = status.data?.settings;
  if (!settings) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  // Keyed on what's saved, so the form starts over after a save.
  return <AiSettingsForm key={`${settings.provider}:${settings.model}:${settings.apiKeyHint}:${settings.baseUrl}`} status={status.data!} />;
}

function AiSettingsForm({ status }: { status: AiStatus }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const settings = status.settings!;
  const on = status.ai.available;

  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const entry = CATALOG[provider];
  const switching = provider !== settings.provider;
  const savedModelInCatalog = entry.models.some((m) => m.id === settings.model);
  // A saved model Kanso's list doesn't have shows as "Other model…" with its id.
  const [modelChoice, setModelChoice] = useState<string>(savedModelInCatalog ? settings.model : OTHER);
  const [otherModel, setOtherModel] = useState(savedModelInCatalog ? "" : settings.model);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? "");
  const [structuredOutputs, setStructuredOutputs] = useState(settings.structuredOutputs);

  const hasKey = settings.apiKeyHint !== null && !switching;
  const model = provider === "custom" || modelChoice === OTHER ? otherModel.trim() : modelChoice;

  function choose(next: ProviderId) {
    setProvider(next);
    setApiKey("");
    const nextEntry = CATALOG[next];
    if (next === settings.provider) {
      const inCatalog = nextEntry.models.some((m) => m.id === settings.model);
      setModelChoice(inCatalog ? settings.model : OTHER);
      setOtherModel(inCatalog ? "" : settings.model);
      setBaseUrl(settings.baseUrl ?? "");
    } else {
      setModelChoice(nextEntry.models.length ? nextEntry.defaultModel : OTHER);
      setOtherModel("");
      setBaseUrl("");
    }
  }

  /** What the form changes, relative to what's saved. */
  function patch(): AiSettingsPatch {
    const next: AiSettingsPatch = {};
    if (switching) next.provider = provider;
    if (apiKey.trim()) next.apiKey = apiKey.trim();
    if (model && (switching || model !== settings.model)) next.model = model;
    if (provider === "custom") {
      if (switching || baseUrl.trim() !== (settings.baseUrl ?? "")) next.baseUrl = baseUrl.trim();
      if (switching || structuredOutputs !== settings.structuredOutputs) next.structuredOutputs = structuredOutputs;
    }
    return next;
  }
  const pending = patch();
  const dirty = Object.keys(pending).length > 0;
  const missing =
    switching && !apiKey.trim()
      ? `Paste an API key for ${entry.label}`
      : !model
        ? "Enter the model id"
        : provider === "custom" && !baseUrl.trim()
          ? "Enter the base URL"
          : null;

  const save = useMutation({
    mutationFn: (body: AiSettingsPatch) => updateAi(slug, body),
    onSuccess: (next: AiStatus, body) => {
      queryClient.setQueryData(aiKeys.status(slug), next);
      if (body.apiKey === null) toast.success("API key removed.");
      else if (body.enabled === false) toast.success("AI is off for everyone.");
      else if (body.enabled) toast.success("AI is back on.");
      else toast.success(body.provider || body.apiKey || body.useAgentKey ? `AI is on, using ${CATALOG[next.settings!.provider].label}.` : "Saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const test = useMutation({
    mutationFn: () => testAi(slug, { ...pending, provider }),
    onSuccess: () => toast.success(`${entry.label} answered. The key and model work.`),
    onError: (error: Error) => toast.error(error.message),
  });
  const canTest = (apiKey.trim() || hasKey) && !missing;
  // The form's own save (not the on/off switch or Remove key).
  const savingForm = save.isPending && save.variables?.enabled === undefined && save.variables?.apiKey !== null && !save.variables?.useAgentKey;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary-text" />
          <h2 className="font-heading text-sm font-semibold text-foreground">AI</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          AI helps your team fill in new issues, break issues into sub-issues, triage issues imported from GitHub,
          summarize long discussions, and answer questions about a project. It only suggests: people review everything
          before it changes an issue. Members can use it; guests can’t.
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3 shadow-card">
          <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/50")} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">
            <StatusText settings={settings} on={on} />
          </p>
          {settings.apiKeyHint !== null || settings.platform !== null ? (
            <Button
              variant="outline"
              size="sm"
              loading={save.isPending && save.variables?.enabled !== undefined}
              onClick={() => save.mutate({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Turn off" : "Turn on"}
            </Button>
          ) : null}
        </div>
      </section>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !missing) save.mutate(pending);
        }}
      >
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-sm font-semibold text-foreground">Provider and model</h2>
          <p className="text-sm text-muted-foreground">
            Use the AI provider your organization already pays for. Usage is billed by that provider to the account
            the key belongs to.
          </p>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={provider} onValueChange={(value) => choose(value as ProviderId)}>
                <SelectTrigger id="ai-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {CATALOG[id].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-model">Model</Label>
              {entry.models.length ? (
                // Remounted per provider, so the trigger shows the new list's label.
                <Select key={provider} value={modelChoice} onValueChange={setModelChoice}>
                  <SelectTrigger id="ai-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {entry.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label} {m.note ? <span className="text-muted-foreground">· {m.note}</span> : null}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>Other model…</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {provider === "custom" || modelChoice === OTHER ? (
                <Input
                  id={entry.models.length ? "ai-model-other" : "ai-model"}
                  aria-label="Model id"
                  value={otherModel}
                  onChange={(event) => setOtherModel(event.target.value)}
                  placeholder={provider === "custom" ? "e.g. anthropic/claude-sonnet-5-5" : "The model id, as the provider names it"}
                  autoComplete="off"
                />
              ) : null}
            </div>
          </div>

          {provider === "custom" ? (
            <div className="flex max-w-xl flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-base-url">Base URL</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  autoComplete="off"
                  inputMode="url"
                />
                <p className="text-xs text-muted-foreground">
                  Any OpenAI-compatible API: OpenRouter, Together, Fireworks, your company’s gateway. It must be a public
                  https address.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={structuredOutputs}
                  onChange={(event) => setStructuredOutputs(event.target.checked)}
                  className="size-4 accent-[var(--primary)]"
                />
                The endpoint supports structured outputs (JSON schema)
              </label>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-sm font-semibold text-foreground">API key</h2>
          <p className="text-sm text-muted-foreground">
            {settings.platform && settings.apiKeyHint === null
              ? "Kanso’s own key is used until you add one. With your key there’s no daily limit. "
              : ""}
            {entry.keyUrl ? (
              <>
                Create a key at{" "}
                <a href={entry.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
                  {new URL(entry.keyUrl).host} <ExternalLink className="size-3" />
                </a>
                .{" "}
              </>
            ) : null}
            It’s stored encrypted and never shown again.
          </p>
          <div className="flex max-w-xl flex-col gap-2">
            <Label htmlFor="ai-key">{hasKey ? `Current key ${settings.apiKeyHint}` : `${entry.label} API key`}</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "Paste a new key to replace it" : entry.keyPlaceholder}
            />
            {switching && settings.apiKeyHint ? (
              <p className="text-xs text-muted-foreground">
                Switching provider replaces the saved {CATALOG[settings.provider].label} key.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {provider === "anthropic" && settings.agentKeyAvailable && !hasKey ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={save.isPending && !!save.variables?.useAgentKey}
                onClick={() => save.mutate({ provider: "anthropic", useAgentKey: true, model: model || undefined })}
              >
                Use the workspace agent’s key
              </Button>
            ) : null}
            {hasKey ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={save.isPending && save.variables?.apiKey === null}
                onClick={() => save.mutate({ apiKey: null })}
              >
                Remove key
              </Button>
            ) : null}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!dirty || Boolean(missing)} loading={savingForm} loadingText="Checking…">
            Save
          </Button>
          <Button type="button" variant="outline" disabled={!canTest} loading={test.isPending} loadingText="Testing…" onClick={() => test.mutate()}>
            <PlugZap />
            Test connection
          </Button>
          {dirty && missing ? <span className="text-xs text-muted-foreground">{missing}</span> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Saving sends one tiny request to check the key and model. Issue text and comments are sent to {entry.label} when
          someone uses AI.
        </p>
      </form>

      <section className="flex flex-col gap-1">
        <h2 className="font-heading text-sm font-semibold text-foreground">Usage</h2>
        <p className="text-xs text-muted-foreground tabular">
          This month: {settings.usage.requests} {settings.usage.requests === 1 ? "request" : "requests"}
          {settings.source === "workspace" || settings.usage.costUsd > 0 ? ` · about $${settings.usage.costUsd.toFixed(2)} (estimate)` : ""}
          {settings.usage.unpricedRequests
            ? ` · ${settings.usage.unpricedRequests} on a model without a known price (cost unknown)`
            : ""}
        </p>
      </section>
    </div>
  );
}

function StatusText({ settings, on }: { settings: NonNullable<AiStatus["settings"]>; on: boolean }) {
  if (!settings.enabled) return <>Off for everyone. Turn it on to bring back the AI actions.</>;
  if (!on) return <>Off. Add an API key below to turn it on.</>;
  if (settings.source === "workspace") {
    return (
      <>
        On, using {CATALOG[settings.provider].label} with the workspace’s key{" "}
        <span className="font-mono text-xs whitespace-nowrap">{settings.apiKeyHint}</span>
      </>
    );
  }
  return (
    <>
      On, included with Kanso{settings.platform?.providerLabel ? ` (${settings.platform.providerLabel})` : ""}: up to{" "}
      {settings.platform?.dailyLimit} requests a day for the workspace.
    </>
  );
}

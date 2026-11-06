"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAiStatus } from "@/components/ai/use-ai";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AI_MODELS, type AiModel, type AiStatus, aiKeys, updateAi } from "@/lib/api/ai";
import { cn } from "@/lib/utils";

const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

/** Settings → AI (admins): the workspace's Claude API key, model, and on/off. */
export function AiSettings() {
  const { slug } = useWorkspace();
  const isAdmin = useCan("workspace.update");
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const [apiKey, setApiKey] = useState("");

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateAi>[1]) => updateAi(slug, patch),
    onSuccess: (next: AiStatus, patch) => {
      queryClient.setQueryData(aiKeys.status(slug), next);
      setApiKey("");
      if (patch.apiKey || patch.useAgentKey) toast.success("AI is on for the workspace.");
      else if (patch.apiKey === null) toast.success("API key removed.");
      else if (patch.enabled === false) toast.success("AI is off for everyone.");
      else if (patch.enabled) toast.success("AI is back on.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

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

  const hasKey = settings.apiKeyHint !== null;
  const canTurnOn = hasKey || settings.platform !== null;
  const on = status.data!.ai.available;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary-text" />
          <h2 className="font-heading text-sm font-semibold text-foreground">AI</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Claude helps your team fill in new issues, break issues into sub-issues, triage issues imported from
          GitHub, summarize long discussions, and answer questions about a project. It only suggests: people
          review everything before it changes an issue. Members can use it; guests can’t.
        </p>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3 shadow-card">
          <span
            className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/50")}
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-sm">
            <StatusText settings={settings} on={on} />
          </p>
          {canTurnOn ? (
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

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">Claude API key</h2>
        <p className="text-sm text-muted-foreground">
          {settings.platform && !hasKey
            ? "Kanso’s own key is used until you add one. With your key there’s no daily limit, and usage is billed to your Claude Console organization."
            : "Usage is billed per request to the Claude Console organization the key belongs to."}{" "}
          Create a key in the{" "}
          <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
            Claude Console <ExternalLink className="size-3" />
          </a>
          . It’s stored encrypted and never shown again.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (apiKey.trim()) save.mutate({ apiKey: apiKey.trim() });
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-2">
            <Label htmlFor="ai-key">{hasKey ? `Current key ${settings.apiKeyHint}` : "API key"}</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "Paste a new key to replace it" : "sk-ant-…"}
            />
          </div>
          <Button type="submit" disabled={!apiKey.trim()} loading={save.isPending && !!save.variables?.apiKey} loadingText="Checking…">
            {hasKey ? "Replace" : "Save"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {settings.agentKeyAvailable && !hasKey ? (
            <Button
              variant="outline"
              size="sm"
              loading={save.isPending && !!save.variables?.useAgentKey}
              onClick={() => save.mutate({ useAgentKey: true })}
            >
              Use the workspace agent’s key
            </Button>
          ) : null}
          {hasKey ? (
            <Button
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

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">Model</h2>
        <div className="flex max-w-sm flex-col gap-2">
          <Select value={settings.model} onValueChange={(value) => save.mutate({ model: value as AiModel })}>
            <SelectTrigger aria-label="Model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label} <span className="text-muted-foreground">· {model.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground tabular">
          This month: {settings.usage.requests} {settings.usage.requests === 1 ? "request" : "requests"}
          {hasKey ? ` · about $${settings.usage.costUsd.toFixed(2)}` : ""}
        </p>
      </section>
    </div>
  );
}

function StatusText({ settings, on }: { settings: NonNullable<AiStatus["settings"]>; on: boolean }) {
  if (!settings.enabled) return <>Off for everyone. Turn it on to bring back the AI actions.</>;
  if (!on) return <>Off. Add a Claude API key below to turn it on.</>;
  if (settings.source === "workspace") {
    return (
      <>
        On, using the workspace’s API key <span className="font-mono text-xs whitespace-nowrap">{settings.apiKeyHint}</span>
      </>
    );
  }
  return <>On, included with Kanso: up to {settings.platform?.dailyLimit} requests a day for the workspace.</>;
}

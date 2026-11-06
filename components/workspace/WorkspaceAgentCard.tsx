"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ClaudeMark } from "@/components/icons/AgentIcon";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Agent,
  agentKeys,
  createAgent,
  deleteAgent,
  fetchWorkspaceAgentGitHub,
  formatCents,
  updateAgent,
  type UpdateAgentInput,
  WORKSPACE_AGENT_MODELS,
  type WorkspaceAgentGitHub,
  type WorkspaceAgentModel,
} from "@/lib/api/agents";
import { cn } from "@/lib/utils";

const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

const modelLabel = (model: WorkspaceAgentModel | undefined) =>
  WORKSPACE_AGENT_MODELS.find((m) => m.id === model)?.label.replace(
    " (cheaper)",
    "",
  ) ?? "Claude";

/**
 * Settings → Agents → Workspace agent (docs/features/18-workspace-agent.md
 * "Setup"): one agent on the workspace's Claude API key that any member can
 * hand work to. Admins connect and manage it; members see that it exists.
 */
export function WorkspaceAgentSection({
  agent,
  isAdmin,
}: {
  agent: Agent | undefined;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!agent && !isAdmin) return null;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">
          Workspace agent
        </h3>
        <p className="text-xs text-muted-foreground">
          One agent for the whole team on the workspace’s Claude API key, billed
          per token. Any member can hand it an issue, and answer it by
          commenting.
        </p>
      </div>
      {agent ? (
        <WorkspaceAgentRow
          agent={agent}
          isAdmin={isAdmin}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-surface px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-chip">
              <ClaudeMark className="size-4" />
            </span>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Connect your organization’s Claude API key, set a monthly limit,
              and everyone can use it. It works in your repositories through
              Kanso’s GitHub App.
            </p>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Plus />
              Connect workspace agent
            </Button>
          </div>
          <GitHubAccess hideWhenReady />
        </div>
      )}
      {isAdmin ? (
        <WorkspaceAgentDialog
          open={editing}
          onOpenChange={setEditing}
          agent={agent}
        />
      ) : null}
    </div>
  );
}

function WorkspaceAgentRow({
  agent,
  isAdmin,
  onEdit,
}: {
  agent: Agent;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: agentKeys.list(slug) });
  const settings = agent.workspaceAgent;

  const toggle = useMutation({
    mutationFn: () => updateAgent(slug, agent.id, { enabled: !agent.enabled }),
    onSuccess: (updated) => {
      refresh();
      toast.success(
        updated.enabled
          ? `${updated.name} enabled.`
          : `${updated.name} disabled. Its running work was stopped.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteAgent(slug, agent.id),
    onSuccess: () => {
      setConfirmDelete(false);
      refresh();
      toast.success("Workspace agent removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-surface px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-chip">
          <ClaudeMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {agent.name}
            {!agent.enabled ? (
              <span className="ml-2 rounded bg-chip px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                Disabled
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {settings
              ? `${modelLabel(settings.model)} · API key ${settings.apiKeyHint}`
              : "Anyone in the workspace can hand it an issue"}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggle.mutate()}
              disabled={toggle.isPending}
            >
              {agent.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${agent.name}`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="ml-11">
          <GitHubAccess />
        </div>
      ) : null}

      {settings && agent.spend ? (
        <SpendMeter
          spentCents={agent.spend.spentCents}
          reservedCents={agent.spend.reservedCents}
          limitCents={settings.monthlyLimitCents}
          runLimitCents={settings.runLimitCents}
        />
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove “{agent.name}”?</DialogTitle>
            <DialogDescription>
              Its running work is stopped and its run history removed. Issues
              stay with their assignee. The environment, agent and vault Kanso
              created stay in your Claude Console for you to clean up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              loadingText="Removing…"
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SpendMeter({
  spentCents,
  reservedCents,
  limitCents,
  runLimitCents,
}: {
  spentCents: number;
  reservedCents: number;
  limitCents: number;
  runLimitCents: number;
}) {
  const pct = (cents: number) =>
    `${Math.min(100, (cents / Math.max(limitCents, 1)) * 100)}%`;
  return (
    <div className="ml-11 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-foreground">
          <span className="font-medium">{formatCents(spentCents)}</span> of{" "}
          {formatCents(limitCents)} this month
        </span>
        <span className="text-muted-foreground">
          Up to {formatCents(runLimitCents)} per run
        </span>
      </div>
      <div
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-chip"
        role="meter"
        aria-label="Spend this month"
        aria-valuemin={0}
        aria-valuemax={limitCents}
        aria-valuenow={spentCents}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: pct(spentCents) }}
        />
        {reservedCents ? (
          <div
            className="h-full rounded-full bg-primary/35"
            style={{ width: pct(reservedCents) }}
          />
        ) : null}
      </div>
      {reservedCents ? (
        <p className="text-xs text-muted-foreground">
          {formatCents(reservedCents)} more is set aside for work in progress.
        </p>
      ) : null}
    </div>
  );
}

type Form = {
  name: string;
  apiKey: string;
  model: WorkspaceAgentModel;
  monthlyLimit: string;
  runLimit: string;
  consoleWorkspaceId: string;
};

function initialForm(agent: Agent | undefined): Form {
  const s = agent?.workspaceAgent;
  return {
    name: agent?.name ?? "Workspace agent",
    apiKey: "",
    model: s?.model ?? "claude-opus-5-5",
    monthlyLimit: s ? String(s.monthlyLimitCents / 100) : "100",
    runLimit: s ? String(s.runLimitCents / 100) : "25",
    consoleWorkspaceId: s?.consoleWorkspaceId ?? "",
  };
}

function WorkspaceAgentDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent | undefined;
}) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => initialForm(agent));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const editing = Boolean(agent);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        model: form.model,
        monthlyLimit: Number(form.monthlyLimit),
        runLimit: Number(form.runLimit),
        consoleWorkspaceId: form.consoleWorkspaceId.trim() || null,
      };
      if (!agent) {
        return (
          await createAgent(slug, {
            kind: "CLAUDE_API",
            ...base,
            apiKey: form.apiKey.trim(),
          })
        ).agent;
      }
      // Secrets are sent only when replaced.
      const patch: UpdateAgentInput = { ...base };
      if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
      return updateAgent(slug, agent.id, patch);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.list(slug) });
      toast.success(
        editing
          ? `${saved.name} updated.`
          : `${saved.name} is ready. Assign it an issue to start.`,
      );
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setForm(initialForm(agent));
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${agent?.name}` : "Connect a workspace agent"}
          </DialogTitle>
          <DialogDescription>
            It runs on Claude Managed Agents with your organization’s API key,
            so usage is billed to that account. Keys are stored encrypted and
            never shown again.
          </DialogDescription>
        </DialogHeader>
        <form
          id="workspace-agent-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <Field
            id="wa-name"
            label="Name"
            hint="What people pick in the assignee menu."
          >
            <Input
              id="wa-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={40}
              required
            />
          </Field>
          <Field
            id="wa-key"
            label="Claude API key"
            hint={
              <>
                Create one in the{" "}
                <a
                  href={CONSOLE_KEYS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  Claude Console <ExternalLink className="size-3" />
                </a>
                .{editing ? " Leave empty to keep the current key." : ""}
              </>
            }
          >
            <Input
              id="wa-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={
                agent?.workspaceAgent
                  ? `Current key ${agent.workspaceAgent.apiKeyHint}`
                  : "sk-ant-…"
              }
              required={!editing}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">GitHub</p>
            <p className="text-xs text-muted-foreground">
              Kanso’s GitHub App pushes the agent’s branches and opens its pull
              requests, only in repositories connected to your projects. Protect
              your base branch with a required review so merging stays with
              people.
            </p>
            <GitHubAccess hideWhenReady />
          </div>
          <Field id="wa-model" label="Model">
            <Select
              value={form.model}
              onValueChange={(value) =>
                set("model", value as WorkspaceAgentModel)
              }
            >
              <SelectTrigger id="wa-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_AGENT_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="wa-monthly" label="Monthly limit ($)">
              <Input
                id="wa-monthly"
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={form.monthlyLimit}
                onChange={(e) => set("monthlyLimit", e.target.value)}
                required
              />
            </Field>
            <Field id="wa-run" label="Per-run limit ($)">
              <Input
                id="wa-run"
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={form.runLimit}
                onChange={(e) => set("runLimit", e.target.value)}
                required
              />
            </Field>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
              Advanced
            </summary>
            <div className="pt-3">
              <Field
                id="wa-console"
                label="Console workspace ID"
                hint="Only if the key isn’t in your organization’s Default workspace: makes “Watch in Console” links open the right place."
              >
                <Input
                  id="wa-console"
                  value={form.consoleWorkspaceId}
                  onChange={(e) => set("consoleWorkspaceId", e.target.value)}
                  placeholder="default"
                />
              </Field>
            </div>
          </details>
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="workspace-agent-form"
            loading={save.isPending}
            loadingText={editing ? "Saving…" : "Connecting…"}
          >
            {editing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Whether Kanso's GitHub App can push for the workspace agent, and who can
 * fix it if not (docs/features/18-workspace-agent.md "GitHub access").
 */
function GitHubAccess({ hideWhenReady = false }: { hideWhenReady?: boolean }) {
  const { slug } = useWorkspace();
  const { data } = useQuery({
    queryKey: agentKeys.github(slug),
    queryFn: () => fetchWorkspaceAgentGitHub(slug),
    staleTime: 60_000,
  });
  if (!data || (hideWhenReady && data.status === "ready")) return null;
  const message = gitHubMessage(data, slug);
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs",
        message.ok
          ? "text-muted-foreground"
          : "rounded-md bg-warning/10 px-3 py-2 text-foreground",
      )}
    >
      {message.ok ? null : (
        <CircleAlert className="mt-px size-3.5 shrink-0 text-warning" />
      )}
      <div className="flex flex-col gap-1">
        <p>{message.text}</p>
        {message.links.length ? (
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {message.links.map((link) =>
              link.internal ? (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-medium underline"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium underline"
                >
                  {link.label} <ExternalLink className="size-3" />
                </a>
              ),
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type GitHubMessage = {
  ok: boolean;
  text: string;
  links: { href: string; label: string; internal?: boolean }[];
};

const listNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

function gitHubMessage(
  github: WorkspaceAgentGitHub,
  slug: string,
): GitHubMessage {
  const integrations = {
    href: `/${slug}/settings/integrations`,
    label: "Open Integrations",
    internal: true,
  };
  switch (github.status) {
    case "ready":
      return {
        ok: true,
        text: `Works through Kanso’s GitHub App on ${listNames(github.accounts.map((a) => a.login))}.`,
        links: [],
      };
    case "needs_approval": {
      const waiting = github.accounts.filter((a) => !a.ready);
      return {
        ok: false,
        text: `Kanso’s GitHub App now asks for access to code and pull requests. ${listNames(waiting.map((a) => a.login))} ${waiting.length === 1 ? "needs" : "need"} to accept it on GitHub before the agent can work there.`,
        links: waiting.map((a) => ({
          href: a.settingsUrl,
          label:
            waiting.length === 1 ? "Review on GitHub" : `Review for ${a.login}`,
        })),
      };
    }
    case "app_needs_access":
      return github.settingsUrl
        ? {
            ok: false,
            text: "Kanso’s GitHub App doesn’t have access to code yet. In its settings, set Contents and Pull requests to Read and write; each connected account then accepts the change.",
            links: [{ href: github.settingsUrl, label: "Open app settings" }],
          }
        : {
            ok: false,
            text: "Kanso’s GitHub App doesn’t have access to code yet. Whoever runs Kanso needs to give it Contents and Pull requests (read and write) access.",
            links: [],
          };
    case "not_connected":
      return {
        ok: false,
        text: "Connect GitHub first: the agent works in the repositories you connect to projects.",
        links: [integrations],
      };
    case "not_configured":
      return {
        ok: false,
        text: "GitHub isn’t set up on this Kanso server yet. The agent needs it to work in your repositories.",
        links: [integrations],
      };
    default:
      return {
        ok: false,
        text: "Couldn’t check Kanso’s GitHub access right now.",
        links: [],
      };
  }
}

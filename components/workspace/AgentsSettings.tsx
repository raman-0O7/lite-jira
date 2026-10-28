"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentIcon } from "@/components/icons/AgentIcon";
import { ago } from "@/components/issue/IssueActivity";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentSetupDialog, OneTimeSecret } from "@/components/workspace/AgentSetupDialog";
import { Snippet } from "@/components/workspace/ApiSettings";
import {
  type Agent,
  type AgentKind,
  agentKeys,
  createAgentToken,
  deleteAgent,
  fetchAgents,
  fetchAgentTokens,
  revokeAgentToken,
  updateAgent,
} from "@/lib/api/agents";

const KIND_LABEL: Record<AgentKind, string> = { CLAUDE_CODE: "Claude Code routine", MCP: "MCP agent" };

/** Settings → Agents (docs/features/12-agents.md "UI", 13-guided-setup.md "Agent setup"). */
export function AgentsSettings({ mcpUrl }: { mcpUrl: string }) {
  const { slug } = useWorkspace();
  const canManage = useCan("agent.manage");
  const [settingUp, setSettingUp] = useState(false);
  const agents = useQuery({ queryKey: agentKeys.list(slug), queryFn: () => fetchAgents(slug) });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-semibold text-foreground">Agents</h2>
            <p className="text-sm text-muted-foreground">
              Assign issues to AI agents like you would to a teammate. An agent claims the issue,
              reports progress, and opens a pull request; a person always merges.
            </p>
          </div>
          {canManage && agents.data?.length ? (
            <Button size="sm" onClick={() => setSettingUp(true)}>
              <Plus />
              Add an agent
            </Button>
          ) : null}
        </div>

        {agents.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : agents.isError ? (
          <p className="text-sm text-muted-foreground">{agents.error.message}</p>
        ) : agents.data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-surface px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft">
              <Bot className="size-5 text-primary-text" />
            </span>
            <div className="flex max-w-sm flex-col gap-1">
              <p className="text-sm font-medium">No agents yet</p>
              <p className="text-sm text-muted-foreground">
                {canManage
                  ? "Connect Claude Code or your own agent in a few guided steps. You’ll be told exactly what to click."
                  : "A workspace admin can add one. Once they do, it shows up in every issue’s assignee menu."}
              </p>
            </div>
            {canManage ? (
              <Button onClick={() => setSettingUp(true)}>
                <Plus />
                Add an agent
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-surface shadow-card">
            {agents.data.map((agent) => (
              <AgentRow key={agent.id} agent={agent} canManage={canManage} mcpUrl={mcpUrl} />
            ))}
          </ul>
        )}
      </section>

      {canManage ? <AgentSetupDialog open={settingUp} onOpenChange={setSettingUp} /> : null}
    </div>
  );
}

function AgentRow({ agent, canManage, mcpUrl }: { agent: Agent; canManage: boolean; mcpUrl: string }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [showTokens, setShowTokens] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: agentKeys.list(slug) });

  const toggle = useMutation({
    mutationFn: () => updateAgent(slug, agent.id, { enabled: !agent.enabled }),
    onSuccess: (updated) => {
      refresh();
      toast.success(updated.enabled ? `${updated.name} enabled.` : `${updated.name} disabled. Its tokens stop working.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteAgent(slug, agent.id),
    onSuccess: () => {
      setConfirmDelete(false);
      refresh();
      toast.success("Agent deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-chip">
          <AgentIcon kind={agent.kind} className="size-4" />
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
            {KIND_LABEL[agent.kind]} · owned by {agent.owner.name} ·{" "}
            {agent.kind === "CLAUDE_CODE" ? (
              <span className="font-mono">{agent.fireUrl}</span>
            ) : agent.webhookUrl ? (
              <>webhook {agent.webhookUrl}</>
            ) : (
              "polls its queue"
            )}
            {agent.tokenCount ? ` · ${agent.tokenCount} token${agent.tokenCount === 1 ? "" : "s"}` : null}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setShowTokens((v) => !v)}>
              <KeyRound />
              Tokens
            </Button>
            <Button variant="outline" size="sm" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
              {agent.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${agent.name}`} onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>

      {showTokens && canManage ? <AgentTokens agent={agent} mcpUrl={mcpUrl} /> : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{agent.name}”?</DialogTitle>
            <DialogDescription>
              Its tokens stop working, its runs are removed, and issues assigned to it become
              unassigned. Comments it wrote stay. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} loadingText="Deleting…" onClick={() => remove.mutate()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function AgentTokens({ agent, mcpUrl }: { agent: Agent; mcpUrl: string }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: agentKeys.tokens(slug, agent.id), queryFn: () => fetchAgentTokens(slug, agent.id) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: agentKeys.tokens(slug, agent.id) });
    queryClient.invalidateQueries({ queryKey: agentKeys.list(slug) });
  };

  const create = useMutation({
    mutationFn: () => createAgentToken(slug, agent.id),
    onSuccess: (data) => {
      setSecret(data.secret);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (tokenId: string) => revokeAgentToken(slug, agent.id, tokenId),
    onSuccess: () => {
      refresh();
      toast.success("Token revoked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="ml-11 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tokens let a self-hosted agent call Kanso’s MCP server as {agent.name}.
        </p>
        <Button size="sm" variant="outline" loading={create.isPending} onClick={() => create.mutate()}>
          <Plus />
          New token
        </Button>
      </div>
      {secret ? <OneTimeSecret label="Agent token" value={secret} onDismiss={() => setSecret(null)} /> : null}
      {secret ? (
        <Snippet
          label="Claude Code"
          text={`claude mcp add --transport http kanso ${mcpUrl} --header "Authorization: Bearer ${secret}"`}
        />
      ) : null}
      {tokens.data?.length ? (
        <ul className="flex flex-col gap-1">
          {tokens.data.map((token) => (
            <li key={token.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono">{token.prefix}…</span>
              <span className="flex-1 text-muted-foreground">
                {token.lastUsedAt ? `Used ${ago(token.lastUsedAt)}` : "Never used"}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Revoke ${token.prefix}`}
                onClick={() => revoke.mutate(token.id)}
                disabled={revoke.isPending}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : tokens.isPending ? null : (
        <p className="text-xs text-muted-foreground">No active tokens.</p>
      )}
    </div>
  );
}

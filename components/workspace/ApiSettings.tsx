"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plug, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ago } from "@/components/issue/IssueActivity";
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
import { ProjectPicker } from "@/components/workspace/ProjectPicker";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import {
  type ApiToken,
  type ConnectedApp,
  type CreateTokenInput,
  type TokenAccess,
  createToken,
  disconnectApp,
  fetchConnectedApps,
  fetchTokens,
  revokeToken,
  tokenKeys,
} from "@/lib/api/tokens";
import { SCOPE_DESCRIPTIONS } from "@/lib/mcp/scopes";

const EXPIRY_CHOICES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Couldn’t copy. Select the text and copy it yourself.");
  }
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ApiSettings({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="flex flex-col gap-8">
      <ConnectInstructions mcpUrl={mcpUrl} />
      <ApiTokens mcpUrl={mcpUrl} />
      <ConnectedApps />
    </div>
  );
}

export function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
          {text}
        </pre>
        <Button variant="outline" size="icon-sm" aria-label={`Copy ${label}`} onClick={() => copy(text, label)}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function ConnectInstructions({ mcpUrl }: { mcpUrl: string }) {
  const json = JSON.stringify({ mcpServers: { kanso: { type: "http", url: mcpUrl } } }, null, 2);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-sm font-semibold text-foreground">Connect an AI client</h2>
        <p className="text-sm text-muted-foreground">
          Kanso is a remote MCP server. Add it to Claude, Cursor, VS Code, or any MCP client; you’ll
          sign in and choose what it may do. It acts as you, with your role in each workspace.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card">
        <Snippet label="Server URL" text={mcpUrl} />
        <Snippet label="Claude Code" text={`claude mcp add --transport http kanso ${mcpUrl}`} />
        <Snippet label="JSON config (Cursor, VS Code, …)" text={json} />
      </div>
    </section>
  );
}

function ApiTokens({ mcpUrl }: { mcpUrl: string }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ token: ApiToken; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const tokens = useQuery({ queryKey: tokenKeys.list(slug), queryFn: () => fetchTokens(slug) });
  const projects = useQuery({ queryKey: projectKeys.lists(slug), queryFn: () => fetchProjects(slug) });
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.key ?? "?";
  const refresh = () => queryClient.invalidateQueries({ queryKey: tokenKeys.list(slug) });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => revokeToken(slug, tokenId),
    onSuccess: () => {
      setRevokeOpen(false);
      refresh();
      toast.success("Token revoked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-sm font-semibold text-foreground">API tokens</h2>
        <p className="text-sm text-muted-foreground">
          For clients that can’t sign in, such as scripts and CI. A token works only in this
          workspace, only with the MCP server, and never beyond your role.
        </p>
      </div>

      <CreateTokenForm
        projects={projects.data ?? []}
        onCreated={(result) => {
          setCreated(result);
          refresh();
        }}
      />

      {created ? <NewSecret secret={created.secret} mcpUrl={mcpUrl} onDismiss={() => setCreated(null)} /> : null}

      {tokens.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tokens.isError ? (
        <p className="text-sm text-muted-foreground">{tokens.error.message}</p>
      ) : tokens.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-surface shadow-card">
          {tokens.data.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-chip text-icon">
                <KeyRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {token.name}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{token.prefix}…</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {token.access === "WRITE" ? "Read & write" : "Read only"} ·{" "}
                  {token.projectIds.length ? token.projectIds.map(projectName).join(", ") : "All projects"} ·
                  Created {day(token.createdAt)} ·{" "}
                  {token.lastUsedAt ? `Used ${ago(token.lastUsedAt)}` : "Never used"} ·{" "}
                  {token.expired ? (
                    <span className="text-destructive">Expired</span>
                  ) : token.expiresAt ? (
                    `Expires ${day(token.expiresAt)}`
                  ) : (
                    "No expiry"
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke ${token.name}`}
                onClick={() => {
                  setRevoking(token);
                  setRevokeOpen(true);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>
              Anything using this token stops working right away. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              loadingText="Revoking…"
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CreateTokenForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string; key: string }[];
  onCreated: (result: { token: ApiToken; secret: string }) => void;
}) {
  const { slug } = useWorkspace();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<TokenAccess>("READ");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]["value"]>("90");

  const create = useMutation({
    mutationFn: () =>
      createToken(slug, {
        name: name.trim(),
        access,
        projectIds,
        expiresInDays: expiry === "never" ? null : (Number(expiry) as CreateTokenInput["expiresInDays"]),
      }),
    onSuccess: (data) => {
      setName("");
      setProjectIds([]);
      onCreated(data);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-2">
        <Label htmlFor="token-name">Name</Label>
        <Input
          id="token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. CI triage bot"
          maxLength={60}
          disabled={create.isPending}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="token-access">Access</Label>
        <Select value={access} onValueChange={(value) => setAccess(value as TokenAccess)}>
          <SelectTrigger id="token-access" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="READ">Read only</SelectItem>
            <SelectItem value="WRITE">Read &amp; write</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Projects</span>
        <ProjectPicker projects={projects} value={projectIds} onChange={setProjectIds} emptyLabel="All projects" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="token-expiry">Expires</Label>
        <Select value={expiry} onValueChange={(value) => setExpiry(value as typeof expiry)}>
          <SelectTrigger id="token-expiry" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" loading={create.isPending} loadingText="Creating…" disabled={!name.trim()}>
        <KeyRound />
        Create token
      </Button>
    </form>
  );
}

function NewSecret({ secret, mcpUrl, onDismiss }: { secret: string; mcpUrl: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">Copy your new token now. You won’t be able to see it again.</p>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={secret} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
        <Button variant="outline" onClick={() => copy(secret, "Token")}>
          <Copy />
          Copy
        </Button>
      </div>
      <Snippet
        label="Claude Code"
        text={`claude mcp add --transport http kanso ${mcpUrl} --header "Authorization: Bearer ${secret}"`}
      />
    </div>
  );
}

function ConnectedApps() {
  const queryClient = useQueryClient();
  const apps = useQuery({ queryKey: tokenKeys.apps, queryFn: fetchConnectedApps });
  const disconnect = useMutation({
    mutationFn: disconnectApp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokenKeys.apps });
      toast.success("App disconnected.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-sm font-semibold text-foreground">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Apps you’ve allowed to act as you, in every workspace you belong to.
        </p>
      </div>
      {apps.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : apps.isError ? (
        <p className="text-sm text-muted-foreground">{apps.error.message}</p>
      ) : apps.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No apps connected.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-surface shadow-card">
          {apps.data.map((app: ConnectedApp) => (
            <li key={app.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {app.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- third-party logo URL from the client's metadata
                <img src={app.icon} alt="" referrerPolicy="no-referrer" className="size-8 rounded-md border object-contain" />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-md bg-chip text-icon">
                  <Plug className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {app.name}
                  {app.site ? <span className="ml-2 text-xs font-normal text-muted-foreground">{app.site}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {app.scopes.includes("kanso:write") ? "Read & write" : "Read only"} · Connected{" "}
                  {day(app.connectedAt)}
                </p>
                <p className="sr-only">
                  {app.scopes.map((s) => SCOPE_DESCRIPTIONS[s] ?? s).join("; ")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnect.mutate(app.id)}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

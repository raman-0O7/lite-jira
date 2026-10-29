"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { CardSkeleton, InlineLoading } from "@/components/loading/skeletons";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitHubAppSetup } from "@/components/workspace/GitHubAppSetup";
import {
  type ConnectedRepo,
  type GitHubInstallation,
  type RepoToggles,
  connectRepo,
  disconnectRepo,
  fetchGitHubSettings,
  fetchInstallationRepos,
  githubKeys,
  removeInstallation,
  startInstall,
  startLink,
  syncRepo,
  unlink,
  updateRepo,
} from "@/lib/api/github";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import { setupKeys } from "@/lib/api/setup";

const RESULT_MESSAGES: Record<string, string> = {
  installed: "GitHub App installed. Connect a repository to a project below.",
  linked: "GitHub account linked.",
  requested: "Install requested. An owner of the GitHub organization needs to approve it.",
};

const TOGGLES: { key: keyof RepoToggles; label: string; hint: string }[] = [
  { key: "importAssigned", label: "Import assigned issues", hint: "Open issues assigned to linked members" },
  { key: "statusSync", label: "Status sync", hint: "Done ⇄ closed, both ways" },
  { key: "moveOnMerge", label: "Move on merge", hint: "Merged PR moves the issue to Done" },
];

/** Settings → Integrations (docs/features/11-github-app.md "UI"). */
export function IntegrationsSettings() {
  const { slug } = useWorkspace();
  const settings = useQuery({ queryKey: githubKeys.settings(slug), queryFn: () => fetchGitHubSettings(slug) });
  useCallbackToast();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-foreground">
          <GitHubMark className="size-4" />
        </span>
        <div>
          <h2 className="font-heading text-sm font-semibold text-foreground">GitHub</h2>
          <p className="text-sm text-muted-foreground">
            Import issues assigned to you, keep status in sync, and see pull requests and checks on
            the issues they mention.
          </p>
        </div>
      </div>

      {settings.isPending ? (
        <CardSkeleton label="Loading GitHub settings" />
      ) : settings.isError ? (
        <p className="text-sm text-muted-foreground">{settings.error.message}</p>
      ) : !settings.data.configured ? (
        settings.data.setup ? (
          <GitHubAppSetup setup={settings.data.setup} />
        ) : (
          <div className="rounded-lg border bg-surface p-4 text-sm text-muted-foreground shadow-card">
            GitHub isn’t available on this server yet. Whoever runs this Kanso server sets it up once; then
            you can install it here on your own GitHub account.
          </div>
        )
      ) : (
        <>
          <AccountLink link={settings.data.link} />
          {settings.data.installations.map((installation) => (
            <Installation key={installation.id} installation={installation} canManage={settings.data.canManage} />
          ))}
          {settings.data.canManage ? <InstallButton hasInstallations={settings.data.installations.length > 0} /> : null}
        </>
      )}
    </section>
  );
}

/** Toast the result of a round trip through GitHub, then clean the URL. */
function useCallbackToast() {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const result = params.get("github");
    const error = params.get("github_error");
    if (!result && !error) return;
    if (error) toast.error(error);
    else if (result && RESULT_MESSAGES[result]) toast.success(RESULT_MESSAGES[result]);
    router.replace(window.location.pathname);
  }, [params, router]);
}

function useRefresh() {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["github", slug] });
    // The Get started checklist and the agent setup dialog show GitHub state too.
    queryClient.invalidateQueries({ queryKey: setupKeys.status(slug) });
  };
}

function AccountLink({ link }: { link: { login: string } | null }) {
  const { slug } = useWorkspace();
  const refresh = useRefresh();
  const go = useMutation({
    mutationFn: () => startLink(slug),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => unlink(slug),
    onSuccess: () => {
      refresh();
      toast.success("GitHub account unlinked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Your GitHub account</p>
        <p className="text-xs text-muted-foreground">
          {link ? (
            <>
              Linked as <span className="font-medium text-foreground">@{link.login}</span>. Issues assigned to you
              in connected repositories come into Kanso.
            </>
          ) : (
            "Link your account so issues assigned to you on GitHub come into Kanso."
          )}
        </p>
      </div>
      {link ? (
        <Button variant="outline" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
          Unlink
        </Button>
      ) : (
        <Button size="sm" loading={go.isPending} loadingText="Opening GitHub…" onClick={() => go.mutate()}>
          Link GitHub account
        </Button>
      )}
    </div>
  );
}

function InstallButton({ hasInstallations }: { hasInstallations: boolean }) {
  const { slug } = useWorkspace();
  const go = useMutation({
    mutationFn: () => startInstall(slug),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="flex items-center gap-3">
      <Button
        variant={hasInstallations ? "outline" : "default"}
        size="sm"
        loading={go.isPending}
        loadingText="Opening GitHub…"
        onClick={() => go.mutate()}
      >
        <GitHubMark className="size-3.5" />
        {hasInstallations ? "Install on another account" : "Install GitHub App"}
      </Button>
      <p className="text-xs text-muted-foreground">Choose which repositories Kanso can see on GitHub.</p>
    </div>
  );
}

function Installation({ installation, canManage }: { installation: GitHubInstallation; canManage: boolean }) {
  const { slug } = useWorkspace();
  const refresh = useRefresh();
  const remove = useMutation({
    mutationFn: () => removeInstallation(slug, installation.id),
    onSuccess: () => {
      refresh();
      toast.success(`Removed @${installation.accountLogin}. Uninstall the app on GitHub to revoke its access.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col rounded-lg border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            @{installation.accountLogin}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{installation.accountType}</span>
            {installation.suspendedAt ? (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                Suspended
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {installation.repos.length
              ? `${installation.repos.length} connected ${installation.repos.length === 1 ? "repository" : "repositories"}`
              : "No repositories connected yet"}
          </p>
        </div>
        {canManage ? (
          <Button
            variant="ghost"
            size="sm"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove @${installation.accountLogin} and its repository connections from Kanso?`)) {
                remove.mutate();
              }
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {installation.repos.length ? (
        <ul className="divide-y">
          {installation.repos.map((repo) => (
            <RepoRow key={repo.id} repo={repo} canManage={canManage} />
          ))}
        </ul>
      ) : null}
      {canManage ? <ConnectRepoForm installation={installation} /> : null}
    </div>
  );
}

function RepoRow({ repo, canManage }: { repo: ConnectedRepo; canManage: boolean }) {
  const { slug } = useWorkspace();
  const canSync = useCan("issue.write");
  const refresh = useRefresh();
  const update = useMutation({
    mutationFn: (patch: Partial<RepoToggles>) => updateRepo(slug, repo.id, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const sync = useMutation({
    mutationFn: () => syncRepo(slug, repo.id),
    onSuccess: ({ imported }) =>
      toast.success(imported ? `Imported ${imported} issue${imported === 1 ? "" : "s"}.` : "Up to date."),
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => disconnectRepo(slug, repo.id),
    onSuccess: () => {
      refresh();
      toast.success(`Disconnected ${repo.repoFullName}.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-foreground">{repo.repoFullName}</span>
        <ArrowRight className="size-3.5 text-icon" />
        <span className="text-sm">
          <span className="font-mono text-xs text-muted-foreground">{repo.project.key}</span> {repo.project.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canSync ? (
            <Button variant="ghost" size="sm" loading={sync.isPending} loadingText="Syncing…" onClick={() => sync.mutate()}>
              <RefreshCw />
              Sync now
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Disconnect ${repo.repoFullName}`}
              onClick={() => {
                if (window.confirm(`Disconnect ${repo.repoFullName}? Imported issues stay.`)) remove.mutate();
              }}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="flex items-center gap-2 text-xs text-muted-foreground" title={toggle.hint}>
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={repo[toggle.key]}
              disabled={!canManage || update.isPending}
              onChange={(event) => update.mutate({ [toggle.key]: event.target.checked })}
            />
            <span className="text-foreground">{toggle.label}</span>
          </label>
        ))}
      </div>
    </li>
  );
}

function ConnectRepoForm({ installation }: { installation: GitHubInstallation }) {
  const { slug } = useWorkspace();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [projectId, setProjectId] = useState("");

  const repos = useQuery({
    queryKey: githubKeys.repos(slug, installation.id),
    queryFn: () => fetchInstallationRepos(slug, installation.id),
    enabled: open,
  });
  const projects = useQuery({ queryKey: projectKeys.lists(slug), queryFn: () => fetchProjects(slug), enabled: open });
  const available = (repos.data ?? []).filter((r) => !r.connected);

  const connect = useMutation({
    mutationFn: () => connectRepo(slug, { installationId: installation.id, repoFullName: repoName, projectId }),
    onSuccess: ({ repo }) => {
      setRepoName("");
      setProjectId("");
      setOpen(false);
      refresh();
      toast.success(`Connected ${repo.repoFullName} to ${repo.project.key}. Importing assigned issues…`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!open) {
    return (
      <div className="border-t px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Connect repository
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (repoName && projectId) connect.mutate();
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label className="text-xs">Repository</Label>
        <Select value={repoName} onValueChange={setRepoName} disabled={repos.isPending}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue
              placeholder={
                repos.isPending ? (
                  <InlineLoading label="Loading repositories…" />
                ) : available.length ? (
                  "Choose…"
                ) : (
                  "No repositories left"
                )
              }
            />
          </SelectTrigger>
          <SelectContent>
            {available.map((repo) => (
              <SelectItem key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
                {repo.private ? " · private" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label className="text-xs">Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(projects.data ?? []).map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.key} · {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!repoName || !projectId} loading={connect.isPending}>
          Connect
        </Button>
      </div>
    </form>
  );
}

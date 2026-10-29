"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { InlineLoading } from "@/components/loading/skeletons";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { connectRepo, fetchGitHubSettings, fetchInstallationRepos, githubKeys } from "@/lib/api/github";
import { type ProjectDetail, projectKeys } from "@/lib/api/projects";
import { setupKeys } from "@/lib/api/setup";

const NO_REPO = "none";

export type RepoChoice = { installationId: string; fullName: string; private: boolean };

/**
 * Repositories this workspace's GitHub installations can see that no project
 * has yet (docs/features/16-github-sync-and-replies.md "Repo when creating a project").
 */
export function useConnectableRepos(enabled: boolean) {
  const { slug } = useWorkspace();
  const settings = useQuery({
    queryKey: githubKeys.settings(slug),
    queryFn: () => fetchGitHubSettings(slug),
    enabled,
  });
  const installations = (settings.data?.installations ?? []).filter((i) => !i.suspendedAt);
  const lists = useQueries({
    queries: installations.map((installation) => ({
      queryKey: githubKeys.repos(slug, installation.id),
      queryFn: () => fetchInstallationRepos(slug, installation.id),
      enabled,
    })),
  });
  const repos: RepoChoice[] = lists.flatMap((list, n) =>
    (list.data ?? [])
      .filter((repo) => !repo.connected)
      .map((repo) => ({ installationId: installations[n]!.id, fullName: repo.fullName, private: repo.private })),
  );
  return {
    configured: settings.data?.configured ?? false,
    installed: installations.length > 0,
    loading: settings.isPending || lists.some((list) => list.isPending),
    repos,
  };
}

/** After connecting, the board, Integrations and the setup checklist all change. */
function useInvalidateRepos(projectId?: string) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["github", slug] });
    queryClient.invalidateQueries({ queryKey: setupKeys.status(slug) });
    if (projectId) queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
  };
}

/** Connect a repository to a project; the repo starts importing its open issues. */
export function useConnectRepo(projectId?: string) {
  const { slug } = useWorkspace();
  const invalidate = useInvalidateRepos(projectId);
  return useMutation({
    mutationFn: ({ repo, projectId: id }: { repo: RepoChoice; projectId: string }) =>
      connectRepo(slug, { installationId: repo.installationId, repoFullName: repo.fullName, projectId: id }),
    onSuccess: invalidate,
  });
}

const choiceValue = (repo: RepoChoice) => `${repo.installationId}:${repo.fullName}`;

/** A repository select; "No repository" is always the first option. */
export function RepoSelect({
  id,
  repos,
  loading,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  repos: RepoChoice[];
  loading: boolean;
  value: RepoChoice | null;
  onChange: (repo: RepoChoice | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ? choiceValue(value) : NO_REPO}
      onValueChange={(next) => onChange(repos.find((repo) => choiceValue(repo) === next) ?? null)}
      disabled={disabled || loading}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={loading ? <InlineLoading label="Loading repositories…" /> : undefined} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_REPO}>{loading ? "Loading repositories…" : "No repository"}</SelectItem>
        {repos.map((repo) => (
          <SelectItem key={choiceValue(repo)} value={choiceValue(repo)}>
            {repo.fullName}
            {repo.private ? " · private" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The project header's GitHub slot: its connected repositories, linking to
 * GitHub, or (for admins) a way to connect one right here.
 */
export function ProjectRepos({ project }: { project: Pick<ProjectDetail, "id" | "key" | "repos"> }) {
  const canManage = useCan("integrations.manage");
  if (project.repos.length) {
    return (
      <div className="hidden items-center gap-1 md:flex">
        {project.repos.map((repo) => (
          <a
            key={repo.id}
            href={`https://github.com/${repo.repoFullName}`}
            target="_blank"
            rel="noreferrer"
            title={`Open ${repo.repoFullName} on GitHub`}
            className="flex h-7 max-w-48 items-center gap-1.5 rounded-md bg-chip px-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <GitHubMark className="size-3.5 shrink-0" />
            <span className="truncate">{repo.repoFullName}</span>
          </a>
        ))}
      </div>
    );
  }
  return canManage ? <ConnectRepoButton project={project} /> : null;
}

function ConnectRepoButton({ project }: { project: Pick<ProjectDetail, "id" | "key"> }) {
  const { slug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<RepoChoice | null>(null);
  const { configured, installed, loading, repos } = useConnectableRepos(open);
  const connect = useConnectRepo(project.id);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setChoice(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="hidden md:inline-flex">
          <GitHubMark className="size-3.5" />
          Connect repo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div>
          <p className="text-sm font-medium">Connect a GitHub repository</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Its open issues come into {project.key}, and agents know which code to work on.
          </p>
        </div>
        {loading ? (
          <InlineLoading label="Loading repositories…" />
        ) : !configured || !installed ? (
          <p className="text-xs text-muted-foreground">
            {configured ? "Install the GitHub App first in " : "GitHub isn’t set up on this server yet. See "}
            <Link className="underline" href={`/${slug}/settings/integrations`} onClick={() => setOpen(false)}>
              Settings → Integrations
            </Link>
            .
          </p>
        ) : repos.length ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!choice) return;
              connect.mutate(
                { repo: choice, projectId: project.id },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setChoice(null);
                    toast.success(`Connected ${choice.fullName}. Importing its open issues…`);
                  },
                  onError: (error: Error) => toast.error(error.message),
                },
              );
            }}
          >
            <RepoSelect repos={repos} loading={false} value={choice} onChange={setChoice} />
            <Button type="submit" size="sm" className="self-end" disabled={!choice} loading={connect.isPending}>
              Connect
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Every repository the app can see is already connected. Give it more in{" "}
            <Link className="underline" href={`/${slug}/settings/integrations`} onClick={() => setOpen(false)}>
              Settings → Integrations
            </Link>
            .
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

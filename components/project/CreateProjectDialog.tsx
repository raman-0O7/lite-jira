"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { type RepoChoice, RepoSelect, useConnectableRepos, useConnectRepo } from "@/components/project/ProjectRepos";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject, projectKeys, suggestProjectKey } from "@/lib/api/projects";

/** Create a project, then open its board. */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { slug } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  // The key follows the name until the user edits it themselves.
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const effectiveKey = keyEdited ? key : name.trim() ? suggestProjectKey(name) : "";
  // Admins can connect a GitHub repository right away (docs/features/16-github-sync-and-replies.md).
  const canConnect = useCan("integrations.manage");
  const github = useConnectableRepos(open && canConnect);
  const showRepo = canConnect && github.installed && (github.loading || github.repos.length > 0);
  const [repo, setRepo] = useState<RepoChoice | null>(null);
  const connect = useConnectRepo();

  function reset() {
    setName("");
    setKey("");
    setKeyEdited(false);
    setRepo(null);
  }

  const create = useMutation({
    mutationFn: async (input: { name: string; key: string }) => {
      const project = await createProject(slug, input);
      if (!repo) return { project, repoError: null };
      // The project exists either way; a failed connect is reported, not fatal.
      const repoError = await connect
        .mutateAsync({ repo, projectId: project.id })
        .then(() => null, (error: Error) => error.message);
      return { project, repoError };
    },
    onSuccess: ({ project, repoError }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists(slug) });
      onOpenChange(false);
      const connected = repo?.fullName;
      reset();
      if (repoError) toast.error(`Project created, but connecting the repository failed: ${repoError}`);
      else toast.success(connected ? `Project created. Importing ${connected}’s open issues…` : "Project created.");
      router.push(`/${slug}/projects/${project.key}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey)) {
      toast.error("Key must be 2–10 letters or digits and start with a letter.");
      return;
    }
    create.mutate({ name: trimmed, key: effectiveKey });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            A new project starts with To Do, In Progress, and Done columns. Its key prefixes
            every issue, like WEB-1, and can’t be changed later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-project-name">Name</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Product roadmap"
              disabled={create.isPending}
              autoFocus
              maxLength={100}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-project-key">Key</Label>
            <Input
              id="new-project-key"
              value={effectiveKey}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
              }}
              placeholder="WEB"
              disabled={create.isPending}
              maxLength={10}
              className="font-mono uppercase"
            />
          </div>
          {showRepo ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-project-repo">GitHub repository (optional)</Label>
              <RepoSelect
                id="new-project-repo"
                repos={github.repos}
                loading={github.loading}
                value={repo}
                onChange={setRepo}
                disabled={create.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Its open issues come in, and agents work on its code.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} loadingText="Creating…">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

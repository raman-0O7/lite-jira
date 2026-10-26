"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BoardCard } from "@/components/board/BoardCard";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createProject,
  fetchProjects,
  projectKeys,
  suggestProjectKey,
} from "@/lib/api/projects";

export function BoardList() {
  const { slug, role } = useWorkspace();
  const canCreate = useCan("project.create");
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  // The key follows the name until the user edits it themselves.
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const effectiveKey = keyEdited ? key : name.trim() ? suggestProjectKey(name) : "";

  const projectsQuery = useQuery({
    queryKey: projectKeys.lists(slug),
    queryFn: () => fetchProjects(slug),
  });

  const create = useMutation({
    mutationFn: (input: { name: string; key: string }) => createProject(slug, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists(slug) });
      setCreateOpen(false);
      setName("");
      setKey("");
      setKeyEdited(false);
      toast.success("Project created.");
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
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        {canCreate ? (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
                <DialogDescription>
                  A new project starts with To Do, In Progress, and Done columns. Its key prefixes every issue, like WEB-1, and can’t be changed later.
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
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
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
        ) : null}
      </div>

      {projectsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : projectsQuery.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm text-destructive">
            {(projectsQuery.error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => projectsQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : projectsQuery.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <p className="font-medium">No projects yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {canCreate
              ? "Create your first project to start organizing issues on a board."
              : role === "GUEST"
                ? "Nothing has been shared with you here yet."
                : "There are no projects in this workspace yet."}
          </p>
          {canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New project
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projectsQuery.data.map((project) => (
            <BoardCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </main>
  );
}

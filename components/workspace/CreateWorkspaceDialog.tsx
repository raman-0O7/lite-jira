"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { createWorkspace } from "@/lib/api/workspaces";
import { slugify } from "@/lib/slug";

/** Name + URL form for a new team workspace; opens it on success. */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  // The URL follows the name until the user edits it themselves.
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const effectiveSlug = slugEdited ? slug : name.trim() ? slugify(name) : "";

  const create = useMutation({
    mutationFn: createWorkspace,
    onSuccess: (workspace) => {
      onOpenChange(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
      toast.success(`Created ${workspace.name}.`);
      router.push(`/${workspace.slug}/projects`);
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    create.mutate({ name: trimmed, slug: slugEdited ? effectiveSlug : undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            A shared space for a team or a client. You’ll be its owner and can invite people
            next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-workspace-name">Name</Label>
            <Input
              id="new-workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Studio"
              disabled={create.isPending}
              autoFocus
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-workspace-slug">URL</Label>
            <div className="flex items-center rounded-md border bg-muted/40 pl-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/50">
              <span className="shrink-0">kanso/</span>
              <input
                id="new-workspace-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                placeholder="acme-studio"
                disabled={create.isPending}
                maxLength={40}
                className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-foreground outline-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">Can’t be changed later.</p>
          </div>
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
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

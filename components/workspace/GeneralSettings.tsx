"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { deleteWorkspace, leaveWorkspace, renameWorkspace } from "@/lib/api/workspaces";

export function GeneralSettings() {
  const workspace = useWorkspace();
  const router = useRouter();
  const canRename = useCan("workspace.update");
  const canDelete = useCan("workspace.delete") && !workspace.personal;
  const [name, setName] = useState(workspace.name);
  const [confirmOpen, setConfirmOpen] = useState<"leave" | "delete" | null>(null);
  const [typed, setTyped] = useState("");

  const onError = (error: Error) => toast.error(error.message);
  // Leaving or deleting: land wherever the user belongs next.
  const goHome = () => {
    router.push("/projects");
    router.refresh();
  };

  const rename = useMutation({
    mutationFn: () => renameWorkspace(workspace.slug, name.trim()),
    onSuccess: () => {
      toast.success("Workspace renamed.");
      router.refresh();
    },
    onError,
  });
  const leave = useMutation({
    mutationFn: () => leaveWorkspace(workspace.slug),
    onSuccess: () => {
      toast.success(`You left ${workspace.name}.`);
      goHome();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspace.slug),
    onSuccess: () => {
      toast.success(`${workspace.name} was deleted.`);
      goHome();
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Workspace</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              toast.error("Name is required.");
              return;
            }
            rename.mutate();
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-2">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canRename || rename.isPending}
              maxLength={60}
            />
          </div>
          {canRename ? (
            <Button
              type="submit"
              disabled={name.trim() === workspace.name}
              loading={rename.isPending}
              loadingText="Saving…"
            >
              Save
            </Button>
          ) : null}
        </form>
        <p className="text-xs text-muted-foreground">
          URL: <span className="font-mono">/{workspace.slug}</span> (can’t be changed)
        </p>
      </section>

      {!workspace.personal ? (
        <section className="flex flex-col gap-3 rounded-xl border border-destructive/30 p-4">
          <h2 className="text-sm font-medium">Danger zone</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Leave this workspace. You’ll need a new invite to come back.
            </p>
            <Button variant="outline" onClick={() => setConfirmOpen("leave")}>
              Leave workspace
            </Button>
          </div>
          {canDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Delete the workspace with all its projects, issues, and history.
              </p>
              <Button
                variant="destructive"
                onClick={() => {
                  setTyped("");
                  setConfirmOpen("delete");
                }}
              >
                Delete workspace
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <Dialog open={confirmOpen !== null} onOpenChange={(open) => !open && setConfirmOpen(null)}>
        <DialogContent>
          {confirmOpen === "leave" ? (
            <>
              <DialogHeader>
                <DialogTitle>Leave {workspace.name}?</DialogTitle>
                <DialogDescription>
                  Your issues here become unassigned. Someone will need to invite you again for
                  you to return.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  loading={leave.isPending}
                  loadingText="Leaving…"
                  onClick={() => leave.mutate()}
                >
                  Leave
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete {workspace.name}?</DialogTitle>
                <DialogDescription>
                  This permanently deletes every project, issue, comment, and invite in it, for
                  everyone. Type <span className="font-mono text-foreground">{workspace.slug}</span>{" "}
                  to confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                aria-label="Workspace URL to confirm"
                className="font-mono"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={typed !== workspace.slug}
                  loading={remove.isPending}
                  loadingText="Deleting…"
                  onClick={() => remove.mutate()}
                >
                  Delete forever
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

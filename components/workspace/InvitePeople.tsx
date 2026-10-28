"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectPicker } from "@/components/workspace/ProjectPicker";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import { setupKeys } from "@/lib/api/setup";
import { type InviteResult, type Role, createInvite, workspaceKeys } from "@/lib/api/workspaces";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

export const ROLE_HINT: Record<Role, string> = {
  OWNER: "Everything, including deleting the workspace",
  ADMIN: "Manages members, invites, and integrations",
  MEMBER: "Creates and edits projects and issues",
  GUEST: "Sees only shared projects; can comment",
};

/** Invite by email or as a link; the caller shows the result with InviteLink. */
export function InviteForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string; key: string }[];
  onCreated: (result: InviteResult) => void;
}) {
  const { slug, role: myRole } = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const choices: Role[] = myRole === "OWNER" ? ["ADMIN", "MEMBER", "GUEST"] : ["MEMBER", "GUEST"];

  const create = useMutation({
    mutationFn: () =>
      createInvite(slug, {
        email: email.trim() || undefined,
        role,
        projectIds: role === "GUEST" ? projectIds : [],
      }),
    onSuccess: (data) => {
      setEmail("");
      setProjectIds([]);
      onCreated(data);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com (optional)"
            disabled={create.isPending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(value) => setRole(value as Role)}>
            <SelectTrigger id="invite-role" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {ROLE_LABEL[choice]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {role === "GUEST" ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Projects</span>
            <ProjectPicker projects={projects} value={projectIds} onChange={setProjectIds} />
          </div>
        ) : null}
        <Button type="submit" loading={create.isPending} loadingText="Inviting…">
          <UserPlus />
          {email.trim() ? "Send invite" : "Create link"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}.</p>
    </div>
  );
}

/** The new invite's link, shown once. */
export function InviteLink({ result, onDismiss }: { result: InviteResult; onDismiss: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn’t copy. Select the link and copy it yourself.");
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          {result.invite.email
            ? result.emailSent
              ? `Invite emailed to ${result.invite.email}. You can also share this link:`
              : `Email isn’t set up yet, so send ${result.invite.email} this link yourself:`
            : "Share this link. It works once and expires in 7 days:"}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={result.url} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
        <Button variant="outline" onClick={copy}>
          <Copy />
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        This link is shown only now. To get another, use “New link” on the invite in Settings → Members.
      </p>
    </section>
  );
}

/**
 * Invite people without leaving the page you're on (the assignee menu, the
 * Get started checklist). Admins only; callers gate it.
 */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<InviteResult | null>(null);
  const projects = useQuery({
    queryKey: projectKeys.lists(slug),
    queryFn: () => fetchProjects(slug),
    enabled: open,
  });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Invite by email, or leave the email empty to get a link anyone can use once. They can
            be assigned issues as soon as they join.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <InviteLink result={result} onDismiss={() => setResult(null)} />
        ) : (
          <InviteForm
            projects={projects.data ?? []}
            onCreated={(data) => {
              setResult(data);
              queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(slug) });
              queryClient.invalidateQueries({ queryKey: setupKeys.status(slug) });
            }}
          />
        )}
        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => setResult(null)}>
              Invite someone else
            </Button>
          ) : null}
          <Button variant={result ? "default" : "outline"} onClick={() => close(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Mail, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/icons/Avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { ProjectPicker } from "@/components/workspace/ProjectPicker";
import { type Member, fetchMembers, memberKeys } from "@/lib/api/members";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import {
  type Invite,
  type InviteResult,
  type Role,
  createInvite,
  fetchInvites,
  removeMember,
  renewInvite,
  revokeInvite,
  setMemberProjects,
  updateMemberRole,
  workspaceKeys,
} from "@/lib/api/workspaces";
import { useSession } from "@/lib/auth-client";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

const ROLE_HINT: Record<Role, string> = {
  OWNER: "Everything, including deleting the workspace",
  ADMIN: "Manages members, invites, and integrations",
  MEMBER: "Creates and edits projects and issues",
  GUEST: "Sees only shared projects; can comment",
};

const PRIVILEGED = new Set<Role>(["OWNER", "ADMIN"]);

function expiresIn(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? "Expires today" : `Expires in ${days} days`;
}

export function MembersSettings() {
  const workspace = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  if (workspace.personal) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
        <h2 className="font-heading text-[15px] font-semibold text-foreground">This is your personal workspace</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          It’s just for you. To work with a team, or to share projects with a client, create a
          team workspace and invite people there.
        </p>
        <Button onClick={() => setCreateOpen(true)}>Create a team workspace</Button>
        <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      </section>
    );
  }

  return <TeamMembers />;
}

function TeamMembers() {
  const { slug, role: myRole } = useWorkspace();
  const canManage = useCan("members.manage");
  const myId = useSession().data?.user.id;
  const queryClient = useQueryClient();
  const [result, setResult] = useState<InviteResult | null>(null);
  // Kept after closing so the dialog's text doesn't blank out mid-animation.
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const members = useQuery({ queryKey: memberKeys.list(slug), queryFn: () => fetchMembers(slug) });
  const invites = useQuery({
    queryKey: workspaceKeys.invites(slug),
    queryFn: () => fetchInvites(slug),
    enabled: canManage,
  });
  const projects = useQuery({
    queryKey: projectKeys.lists(slug),
    queryFn: () => fetchProjects(slug),
    enabled: canManage,
  });

  const refreshMembers = () => queryClient.invalidateQueries({ queryKey: memberKeys.list(slug) });
  const refreshInvites = () =>
    queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(slug) });
  const onError = (error: Error) => toast.error(error.message);

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      updateMemberRole(slug, userId, role),
    onSuccess: () => {
      refreshMembers();
      toast.success("Role updated.");
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(slug, userId),
    onSuccess: () => {
      setRemoveOpen(false);
      refreshMembers();
      toast.success("Removed from the workspace.");
    },
    onError,
  });
  const share = useMutation({
    mutationFn: ({ userId, projectIds }: { userId: string; projectIds: string[] }) =>
      setMemberProjects(slug, userId, projectIds),
    onSuccess: refreshMembers,
    onError,
  });
  const renew = useMutation({
    mutationFn: renewInvite,
    onSuccess: (data) => {
      setResult(data);
      refreshInvites();
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: revokeInvite,
    onSuccess: () => {
      refreshInvites();
      toast.success("Invite revoked.");
    },
    onError,
  });

  /** Mirrors the server rule: admins manage members and guests; owners manage everyone. */
  const canEditMember = (member: Member) =>
    canManage && (myRole === "OWNER" || !PRIVILEGED.has(member.role));
  const roleChoices: Role[] =
    myRole === "OWNER" ? ["OWNER", "ADMIN", "MEMBER", "GUEST"] : ["MEMBER", "GUEST"];

  return (
    <div className="flex flex-col gap-8">
      {canManage ? (
        <InviteForm
          projects={projects.data ?? []}
          onCreated={(data) => {
            setResult(data);
            refreshInvites();
          }}
        />
      ) : null}

      {result ? <InviteLink result={result} onDismiss={() => setResult(null)} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          Members{members.data ? ` · ${members.data.length}` : ""}
        </h2>
        {members.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : members.isError ? (
          <p className="text-sm text-muted-foreground">{members.error.message}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-surface shadow-card">
            {members.data.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar person={member} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {member.id === myId ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>

                {member.role === "GUEST" && canManage ? (
                  <ProjectPicker
                    projects={projects.data ?? []}
                    value={member.projectIds}
                    disabled={share.isPending}
                    onChange={(projectIds) => share.mutate({ userId: member.id, projectIds })}
                  />
                ) : null}

                {canEditMember(member) ? (
                  <Select
                    value={member.role}
                    onValueChange={(role) => changeRole.mutate({ userId: member.id, role: role as Role })}
                    disabled={changeRole.isPending}
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${member.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {roleChoices.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="w-28 text-sm text-muted-foreground">{ROLE_LABEL[member.role]}</span>
                )}

                {canEditMember(member) && member.id !== myId ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => {
                      setRemoving(member);
                      setRemoveOpen(true);
                    }}
                  >
                    <X />
                  </Button>
                ) : (
                  <span className="size-7" aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && invites.data && invites.data.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-sm font-semibold text-foreground">Pending invites</h2>
          <ul className="divide-y rounded-lg border bg-surface shadow-card">
            {invites.data.map((invite: Invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-chip text-icon">
                  {invite.email ? <Mail className="size-4" /> : <Link2 className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{invite.email ?? "Anyone with the link"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABEL[invite.role]} ·{" "}
                    {invite.expired ? (
                      <span className="text-destructive">Expired</span>
                    ) : (
                      expiresIn(invite.expiresAt)
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => renew.mutate(invite.id)}
                  disabled={renew.isPending}
                >
                  <RefreshCw />
                  New link
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Revoke invite"
                  onClick={() => revoke.mutate(invite.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              They lose access to this workspace right away, and their issues here become
              unassigned. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              loadingText="Removing…"
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InviteForm({
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
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-sm font-semibold text-foreground">Invite people</h2>
        <p className="text-sm text-muted-foreground">
          Invite by email, or leave the email empty to get a link anyone can use once.
        </p>
      </div>
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
    </section>
  );
}

function InviteLink({ result, onDismiss }: { result: InviteResult; onDismiss: () => void }) {
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
        This link is shown only now. Use “New link” on the invite to get another.
      </p>
    </section>
  );
}

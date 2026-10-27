"use client";

import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { KansoMark } from "@/components/icons/KansoMark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import type { WorkspaceSummary } from "@/lib/api/workspaces";

export const workspaceLabel = (workspace: Pick<WorkspaceSummary, "name" | "personal">) =>
  workspace.personal ? "Personal" : workspace.name;

/** Sidebar header: switch workspace, open its settings, or create a new one. */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Workspace: ${workspaceLabel(current)}`}
          className="flex h-[34px] w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-sidebar-accent"
        >
          <KansoMark />
          <span className="min-w-0 flex-1 truncate font-heading text-sm font-semibold tracking-[-0.01em] text-foreground">
            {workspaceLabel(current)}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-icon" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} asChild>
              <Link href={`/${workspace.slug}/projects`}>
                <span className="flex-1 truncate">{workspaceLabel(workspace)}</span>
                {workspace.role === "GUEST" ? (
                  <span className="text-xs text-muted-foreground">Guest</span>
                ) : null}
                {workspace.id === current.id ? <Check className="size-4" /> : null}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${current.slug}/settings/members`}>
              <Settings />
              Settings & members
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

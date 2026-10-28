"use client";

import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Plus, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAppUI } from "@/components/app-shell/app-ui";
import { UserMenu } from "@/components/app-shell/user-menu";
import { Kbd } from "@/components/icons/Kbd";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { SidebarProjectsSkeleton } from "@/components/loading/skeletons";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import type { WorkspaceSummary } from "@/lib/api/workspaces";
import { cn } from "@/lib/utils";

export type ShellUser = { id: string; name: string; email: string; image?: string | null };

function NavItem({
  href,
  active,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-[15px] [&_svg]:shrink-0",
        active
          ? "bg-sidebar-accent text-foreground shadow-seg dark:shadow-none"
          : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground [&_svg]:text-icon",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

export function Sidebar({
  workspaces,
  user,
  onNavigate,
  onClose,
}: {
  workspaces: WorkspaceSummary[];
  user: ShellUser;
  /** Called when a link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Shown as a close button in the mobile drawer. */
  onClose?: () => void;
}) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const canCreate = useCan("project.create");
  const { setPaletteOpen, setCreateProjectOpen } = useAppUI();
  const base = `/${workspace.slug}`;

  const projectsQuery = useQuery({
    queryKey: projectKeys.lists(workspace.slug),
    queryFn: () => fetchProjects(workspace.slug),
  });

  return (
    <div className="flex h-full w-60 flex-col gap-3 px-3 pt-3 pb-2 text-sidebar-foreground">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex size-7 items-center justify-center rounded-md text-icon hover:bg-sidebar-accent"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-[30px] items-center gap-2 rounded-md border border-sidebar-border bg-field px-2 text-left text-sm text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Search className="size-3.5 shrink-0 text-icon" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav aria-label="Workspace" className="flex flex-col gap-px">
        <NavItem
          href={`${base}/projects`}
          active={pathname === `${base}/projects`}
          icon={<LayoutGrid />}
          onNavigate={onNavigate}
        >
          Projects
        </NavItem>
        <NavItem
          href={`${base}/settings/members`}
          active={pathname.startsWith(`${base}/settings`)}
          icon={<Settings />}
          onNavigate={onNavigate}
        >
          Settings
        </NavItem>
      </nav>

      <section aria-labelledby="sidebar-projects" className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex h-6 items-center justify-between pr-1 pl-2">
          <h2 id="sidebar-projects" className="text-2xs font-medium text-muted-foreground">
            Projects
          </h2>
          {canCreate ? (
            <button
              type="button"
              onClick={() => setCreateProjectOpen(true)}
              aria-label="New project"
              title="New project"
              className="flex size-5 items-center justify-center rounded text-icon hover:bg-sidebar-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>
        <ul className="-mx-1 flex min-h-0 flex-col gap-px overflow-y-auto px-1">
          {projectsQuery.data?.map((project) => {
            const href = `${base}/projects/${project.key}`;
            return (
              <li key={project.id}>
                <NavItem
                  href={href}
                  active={pathname === href}
                  icon={<ProjectTile projectKey={project.key} name={project.name} />}
                  onNavigate={onNavigate}
                >
                  {project.name}
                </NavItem>
              </li>
            );
          })}
          {projectsQuery.isPending ? <SidebarProjectsSkeleton /> : null}
          {projectsQuery.data?.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">No projects yet</li>
          ) : null}
        </ul>
      </section>

      <UserMenu user={user} />
    </div>
  );
}

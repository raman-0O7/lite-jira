"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FolderPlus,
  Keyboard,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { useAppUI } from "@/components/app-shell/app-ui";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { useTheme } from "@/components/theme/use-theme";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { workspaceLabel } from "@/components/workspace/WorkspaceSwitcher";
import { searchIssues } from "@/lib/api/issues";
import { fetchProjects, projectKeys } from "@/lib/api/projects";
import type { WorkspaceSummary } from "@/lib/api/workspaces";
import { cn } from "@/lib/utils";

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  /** Extra words to match on. */
  keywords?: string;
  icon: React.ReactNode;
  hint?: React.ReactNode;
  run: () => void;
};

const GROUP_ORDER = ["Issues", "Actions", "Projects", "Navigation", "Workspaces"];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** ⌘K: search issues, jump to projects and pages, run actions. */
export function CommandPalette({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const { paletteOpen, setPaletteOpen } = useAppUI();
  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[580px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search issues, jump to a project or page, or run an action.
        </DialogDescription>
        {/* Mounted only while open, so every opening starts fresh. */}
        {paletteOpen ? (
          <PaletteBody workspaces={workspaces} close={() => setPaletteOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ workspaces, close }: { workspaces: WorkspaceSummary[]; close: () => void }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const canCreateProject = useCan("project.create");
  const { newIssue, setShortcutsOpen, setCreateProjectOpen } = useAppUI();
  const { resolved, setTheme } = useTheme();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 150);
  const base = `/${workspace.slug}`;

  const projectsQuery = useQuery({
    queryKey: projectKeys.lists(workspace.slug),
    queryFn: () => fetchProjects(workspace.slug),
  });
  const issuesQuery = useQuery({
    queryKey: ["issue-search", workspace.slug, debounced],
    queryFn: () => searchIssues(workspace.slug, debounced),
    enabled: debounced.length > 0,
    retry: false,
    staleTime: 10_000,
  });

  function go(href: string) {
    close();
    router.push(href);
  }

  const items: PaletteItem[] = [];
  if (newIssue) {
    items.push({
      id: "new-issue",
      group: "Actions",
      label: "New issue",
      keywords: "create add",
      icon: <Plus />,
      hint: "C",
      run: () => {
        close();
        newIssue();
      },
    });
  }
  if (canCreateProject) {
    items.push({
      id: "new-project",
      group: "Actions",
      label: "New project",
      keywords: "create add",
      icon: <FolderPlus />,
      run: () => {
        close();
        setCreateProjectOpen(true);
      },
    });
  }
  items.push(
    {
      id: "theme",
      group: "Actions",
      label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
      keywords: "theme dark light mode appearance",
      icon: resolved === "dark" ? <Sun /> : <Moon />,
      run: () => {
        close();
        setTheme(resolved === "dark" ? "light" : "dark");
      },
    },
    {
      id: "shortcuts",
      group: "Actions",
      label: "Keyboard shortcuts",
      keywords: "help keys hotkeys",
      icon: <Keyboard />,
      hint: "?",
      run: () => {
        close();
        setShortcutsOpen(true);
      },
    },
  );
  for (const project of projectsQuery.data ?? []) {
    items.push({
      id: `project-${project.id}`,
      group: "Projects",
      label: project.name,
      keywords: project.key,
      icon: <ProjectTile projectKey={project.key} name={project.name} />,
      hint: <span className="font-mono">{project.key}</span>,
      run: () => go(`${base}/projects/${project.key}`),
    });
  }
  items.push(
    {
      id: "nav-projects",
      group: "Navigation",
      label: "Go to projects",
      keywords: "home all",
      icon: <LayoutGrid />,
      hint: "G P",
      run: () => go(`${base}/projects`),
    },
    {
      id: "nav-members",
      group: "Navigation",
      label: "Go to members",
      keywords: "settings invite people team",
      icon: <Users />,
      hint: "G S",
      run: () => go(`${base}/settings/members`),
    },
    {
      id: "nav-general",
      group: "Navigation",
      label: "Go to general settings",
      keywords: "workspace rename",
      icon: <SlidersHorizontal />,
      run: () => go(`${base}/settings/general`),
    },
  );
  for (const other of workspaces) {
    if (other.id === workspace.id) continue;
    items.push({
      id: `workspace-${other.id}`,
      group: "Workspaces",
      label: `Switch to ${workspaceLabel(other)}`,
      keywords: other.slug,
      icon: <ArrowRight />,
      run: () => go(`/${other.slug}/projects`),
    });
  }

  const needle = trimmed.toLowerCase();
  const matching = needle
    ? items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(needle))
    : items;
  const issueItems: PaletteItem[] =
    trimmed && issuesQuery.data
      ? issuesQuery.data.slice(0, 8).map((issue) => ({
          id: `issue-${issue.id}`,
          group: "Issues",
          label: issue.title,
          icon: <IssueTypeIcon type={issue.type} decorative />,
          hint: <span className="font-mono">{issue.key}</span>,
          run: () => go(`${base}/issues/${issue.key}`),
        }))
      : [];
  const visible = [...issueItems, ...matching].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );
  const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));
  const searching = trimmed.length > 0 && (debounced !== trimmed || issuesQuery.isFetching);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % Math.max(visible.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + visible.length) % Math.max(visible.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      visible[activeIndex]?.run();
    }
  }

  let lastGroup = "";
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-icon" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={visible[activeIndex] ? `${listId}-${visible[activeIndex].id}` : undefined}
          aria-label="Search issues, projects, and actions"
          placeholder="Search issues or type a command…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {searching ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="max-h-[min(380px,60vh)] overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {issuesQuery.isError
              ? (issuesQuery.error as Error).message
              : searching
                ? "Searching…"
                : "No results."}
          </p>
        ) : (
          visible.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id} role="presentation">
                {header ? (
                  <div role="presentation" className="px-2.5 pt-2 pb-1 text-2xs font-medium text-muted-foreground">
                    {header}
                  </div>
                ) : null}
                <div
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseMove={() => index !== activeIndex && setActive(index)}
                  onClick={item.run}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm [&_svg]:size-[15px] [&_svg]:shrink-0",
                    index === activeIndex ? "bg-accent text-foreground" : "text-soft [&>svg]:text-icon",
                  )}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? <span className="shrink-0 text-2xs text-muted-foreground">{item.hint}</span> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex h-9 items-center gap-4 border-t px-4 text-2xs text-muted-foreground">
        <span>↑↓ to move</span>
        <span>↵ to open</span>
        <span>esc to close</span>
        <span className="ml-auto hidden sm:inline">
          Try <span className="font-mono">assignee:me is:open</span>
        </span>
      </div>
    </div>
  );
}


"use client";

import { useRouter } from "next/navigation";

import { AppUIProvider, useAppUI } from "@/components/app-shell/app-ui";
import { CommandPalette } from "@/components/app-shell/CommandPalette";
import { ShortcutsDialog } from "@/components/app-shell/ShortcutsDialog";
import { type ShellUser, Sidebar } from "@/components/app-shell/Sidebar";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { WorkspaceSummary } from "@/lib/api/workspaces";
import { cn } from "@/lib/utils";

/**
 * The workspace shell: the sidebar on the chrome background, and the page in
 * an inset panel. Below `md` the sidebar is a drawer.
 */
export function AppShell(props: {
  workspaces: WorkspaceSummary[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  return (
    <AppUIProvider>
      <Shell {...props} />
    </AppUIProvider>
  );
}

function Shell({
  workspaces,
  user,
  children,
}: {
  workspaces: WorkspaceSummary[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { slug } = useWorkspace();
  const ui = useAppUI();

  // Navigating by shortcut closes any open help/palette so the page is usable.
  function goTo(href: string) {
    ui.setShortcutsOpen(false);
    ui.setPaletteOpen(false);
    router.push(href);
  }

  useHotkeys({
    "mod+k": () => ui.setPaletteOpen(!ui.paletteOpen),
    "?": () => ui.setShortcutsOpen(true),
    "mod+?": () => ui.setShortcutsOpen(!ui.shortcutsOpen),
    "g m": () => goTo(`/${slug}/my-work`),
    "g i": () => goTo(`/${slug}/issues`),
    "g p": () => goTo(`/${slug}/projects`),
    "g s": () => goTo(`/${slug}/settings/members`),
    c: () => ui.newIssue?.(),
  });

  return (
    <div className="flex h-dvh min-h-0 w-full bg-chrome">
      <aside aria-label="Sidebar" className="hidden shrink-0 md:flex">
        <Sidebar workspaces={workspaces} user={user} />
      </aside>

      {/* Mobile drawer; following a link closes it. */}
      <div
        className={cn("fixed inset-0 z-40 md:hidden", ui.sidebarOpen ? "block" : "hidden")}
      >
        <div className="absolute inset-0 bg-black/40" onClick={() => ui.setSidebarOpen(false)} />
        <aside aria-label="Sidebar" className="absolute inset-y-0 left-0 flex border-r bg-chrome shadow-panel">
          <Sidebar
            workspaces={workspaces}
            user={user}
            onNavigate={() => ui.setSidebarOpen(false)}
            onClose={() => ui.setSidebarOpen(false)}
          />
        </aside>
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:shadow-panel">
        <button
          type="button"
          onClick={() => ui.setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts (⌘⇧?)"
          title="Keyboard shortcuts (⌘⇧?)"
          className="absolute right-4 bottom-3 z-10 hidden h-5 items-center rounded-[4px] bg-kbd px-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground md:inline-flex"
        >
          ?
        </button>
        {children}
      </main>

      <CommandPalette workspaces={workspaces} />
      <ShortcutsDialog />
      <CreateProjectDialog open={ui.createProjectOpen} onOpenChange={ui.setCreateProjectOpen} />
    </div>
  );
}

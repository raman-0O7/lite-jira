"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { useAppUI } from "@/components/app-shell/app-ui";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { AgentSetupDialog } from "@/components/workspace/AgentSetupDialog";
import { InviteDialog } from "@/components/workspace/InvitePeople";
import { fetchSetup, setupKeys } from "@/lib/api/setup";
import { cn } from "@/lib/utils";

// Dismissal is per browser and workspace. When storage is unavailable
// (private mode) it lasts until the page reloads.
const dismissedHere = new Set<string>();
const listeners = new Set<() => void>();
const storageKey = (slug: string) => `kanso:get-started-dismissed:${slug}`;

function isDismissed(slug: string) {
  if (dismissedHere.has(slug)) return true;
  try {
    return localStorage.getItem(storageKey(slug)) === "1";
  } catch {
    return false;
  }
}

function dismiss(slug: string) {
  dismissedHere.add(slug);
  try {
    localStorage.setItem(storageKey(slug), "1");
  } catch {
    // Kept in memory above.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

type Item = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  action: { label: string; onClick: () => void } | { label: string; href: string };
};

/**
 * The Projects page's "Get started" card (docs/features/13-guided-setup.md
 * "Get started"): everything Kanso can do, each a click from being set up.
 * Items tick themselves from the setup status; only the ones the viewer may
 * do are listed. Hidden for guests, once dismissed, or when all are done.
 */
export function GetStarted({ projectCount }: { projectCount: number }) {
  const { slug, role, personal } = useWorkspace();
  const canCreateProject = useCan("project.create");
  const canInvite = useCan("members.manage") && !personal;
  const canAddAgent = useCan("agent.manage");
  const canConnectGitHub = useCan("integrations.manage");
  const { setCreateProjectOpen } = useAppUI();
  const [inviting, setInviting] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(slug), () => true);

  const setup = useQuery({
    queryKey: setupKeys.status(slug),
    queryFn: () => fetchSetup(slug),
    enabled: role !== "GUEST" && !dismissed,
    // Steps finish on other pages (and in Claude); check again on return.
    staleTime: 0,
  });

  if (role === "GUEST" || dismissed || !setup.data) return null;
  const { status } = setup.data;

  const candidates: (Item | false)[] = [
    canCreateProject && {
      id: "project",
      title: "Create a project",
      description: "A board where your team’s issues live.",
      done: projectCount > 0,
      action: { label: "New project", onClick: () => setCreateProjectOpen(true) },
    },
    canInvite && {
      id: "invite",
      title: "Invite your team",
      description: "Assign them issues and work on the board together.",
      done: status.teammates,
      action: { label: "Invite", onClick: () => setInviting(true) },
    },
    canAddAgent && {
      id: "agent",
      title: "Add an AI agent",
      description: "Assign issues to Claude Code. It works in your repo and opens a pull request for you to review.",
      done: status.agents,
      action: { label: "Set up", onClick: () => setAddingAgent(true) },
    },
    canConnectGitHub && {
      id: "github",
      title: "Connect GitHub",
      description: "Import issues, and let pull requests move cards and close issues when they merge.",
      done: status.github,
      action: { label: "Connect", href: `/${slug}/settings/integrations` },
    },
    {
      id: "assistant",
      title: "Use Kanso from your AI assistant",
      description: "Ask Claude, Cursor, or VS Code to find, create, and update issues for you.",
      done: status.assistant,
      action: { label: "Connect", href: `/${slug}/settings/api` },
    },
  ];
  const items = candidates.filter((item): item is Item => Boolean(item));

  const doneCount = items.filter((item) => item.done).length;
  if (doneCount === items.length) return null;

  return (
    <section aria-labelledby="get-started" className="mx-5 mt-4 mb-2 rounded-xl border bg-surface shadow-card">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="get-started" className="font-heading text-sm font-semibold">
            Get started with Kanso
          </h2>
          <p className="text-xs text-muted-foreground">
            {doneCount} of {items.length} done
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Hide Get started" onClick={() => dismiss(slug)}>
          <X />
        </Button>
      </div>
      <div className="mx-4 h-1 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
      <ul className="mt-2 divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                item.done ? "bg-success text-on-success" : "border border-dashed border-muted-foreground/50",
              )}
              aria-hidden
            >
              {item.done ? <Check className="size-3" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", item.done && "text-muted-foreground line-through")}>
                {item.title}
                <span className="sr-only">{item.done ? " (done)" : ""}</span>
              </p>
              {item.done ? null : <p className="text-xs text-muted-foreground">{item.description}</p>}
            </div>
            {item.done ? null : "href" in item.action ? (
              <Button asChild variant="outline" size="sm">
                <Link href={item.action.href}>{item.action.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={item.action.onClick}>
                {item.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canInvite ? <InviteDialog open={inviting} onOpenChange={setInviting} /> : null}
      {canAddAgent ? <AgentSetupDialog open={addingAgent} onOpenChange={setAddingAgent} /> : null}
    </section>
  );
}

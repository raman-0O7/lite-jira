"use client";

import { createContext, useContext } from "react";

import { type Action, can } from "@/lib/permissions";
import type { WorkspaceSummary } from "@/lib/services/workspaces";

const WorkspaceContext = createContext<WorkspaceSummary | null>(null);

/** Provides the current workspace (from the [workspace] layout) to client components. */
export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceSummary {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used under app/(app)/[workspace]");
  }
  return workspace;
}

/**
 * Whether the signed-in user may do `action` here, for hiding controls. The
 * server enforces the same rules; this only keeps the UI honest.
 */
export function useCan(action: Action): boolean {
  const { role } = useWorkspace();
  return can({ actor: { type: "user", userId: "" }, role }, action);
}

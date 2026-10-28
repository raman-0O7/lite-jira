"use client";

import { useState } from "react";

import type { AssigneeShortcuts } from "@/components/issue/IssueFields";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { AgentSetupDialog } from "@/components/workspace/AgentSetupDialog";
import { InviteDialog } from "@/components/workspace/InvitePeople";
import type { Agent } from "@/lib/api/agents";

/**
 * The assignee menu's "Invite people…" and "Add an AI agent…" rows and the
 * dialogs they open (docs/features/13-guided-setup.md "Assignee menu"). Render
 * `dialogs` next to the picker; pass `shortcuts` to it.
 */
export function useAssigneeShortcuts({ onAssignAgent }: { onAssignAgent?: (agent: Agent) => void } = {}) {
  const { role, personal } = useWorkspace();
  // A personal workspace is just for its owner: nobody to invite or ask.
  const canInvite = useCan("members.manage") && !personal;
  const askAdminToInvite = !personal && !canInvite;
  const canAddAgent = useCan("agent.manage");
  const [inviting, setInviting] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);

  // Open once the menu has closed, so focus lands in the dialog rather than
  // returning to the menu's trigger.
  const openLater = (open: (value: boolean) => void) => () => setTimeout(() => open(true), 0);

  const shortcuts: AssigneeShortcuts | undefined =
    role === "GUEST"
      ? undefined
      : {
          onInvite: canInvite ? openLater(setInviting) : undefined,
          onAddAgent: canAddAgent ? openLater(setAddingAgent) : undefined,
          hint:
            askAdminToInvite && !canAddAgent
              ? "Ask an admin to invite people or add an AI agent."
              : !canAddAgent
                ? "Ask an admin to add an AI agent."
                : askAdminToInvite
                  ? "Ask an admin to invite people."
                  : undefined,
        };

  const dialogs = (
    <>
      {canInvite ? <InviteDialog open={inviting} onOpenChange={setInviting} /> : null}
      {canAddAgent ? (
        <AgentSetupDialog open={addingAgent} onOpenChange={setAddingAgent} onAssign={onAssignAgent} />
      ) : null}
    </>
  );

  return { shortcuts, dialogs };
}

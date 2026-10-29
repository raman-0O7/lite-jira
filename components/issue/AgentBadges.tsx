import { AgentIcon } from "@/components/icons/AgentIcon";
import { Avatar } from "@/components/icons/Avatar";
import { RUN_STATUS_LABEL, type AgentKind, type AgentRunStatus } from "@/lib/api/agents";
import type { PersonStub } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

const TONE: Record<AgentRunStatus, string> = {
  QUEUED: "text-muted-foreground",
  DISPATCHED: "text-info",
  RUNNING: "text-review",
  NEEDS_INPUT: "text-warning",
  PR_OPEN: "text-success",
  DONE: "text-success",
  FAILED: "text-danger",
  CANCELLED: "text-muted-foreground",
};

/** A run's status as a compact pill: the agent's icon plus "Working", "Failed", …. */
export function RunStatusBadge({
  status,
  name,
  kind,
  className,
}: {
  status: AgentRunStatus;
  /** The agent's name, for the tooltip. */
  name?: string;
  kind?: AgentKind;
  className?: string;
}) {
  return (
    <span
      title={name ? `${name}: ${RUN_STATUS_LABEL[status]}` : RUN_STATUS_LABEL[status]}
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-[5px] border px-1 text-2xs font-medium",
        TONE[status],
        className,
      )}
    >
      {/* The Claude mark keeps its colour; a bot takes the status colour. */}
      <AgentIcon
        kind={kind}
        className={cn("size-3", kind !== "CLAUDE_CODE" && "text-current", status === "RUNNING" && "animate-pulse")}
      />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

/** An agent in place of a person's avatar. */
export function AgentAvatar({ name, kind, className }: { name: string; kind?: AgentKind; className?: string }) {
  return (
    <span
      title={name}
      aria-label={name}
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-chip", className)}
    >
      <AgentIcon kind={kind} className="size-3" />
    </span>
  );
}

/**
 * The assignee on a card or row: the person, with their agent's badge tucked
 * against it while the agent works the issue.
 */
export function AssigneeAvatars({
  person,
  agent,
  className,
}: {
  person: PersonStub | null;
  agent: { name: string; kind: AgentKind } | null | undefined;
  className?: string;
}) {
  if (!person && !agent) return null;
  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      {person ? <Avatar person={person} /> : null}
      {agent ? (
        <AgentAvatar
          name={person ? `${agent.name}, working for ${person.name}` : agent.name}
          kind={agent.kind}
          className={person ? "-ml-1.5 ring-2 ring-surface" : undefined}
        />
      ) : null}
    </span>
  );
}

/** The card badge shows live and failed runs; finished or cancelled ones say nothing. */
export function cardRunStatus(runs: { status: AgentRunStatus }[] | undefined): AgentRunStatus | null {
  const status = runs?.[0]?.status;
  return status && status !== "DONE" && status !== "CANCELLED" ? status : null;
}

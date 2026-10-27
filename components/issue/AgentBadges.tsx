import { Bot } from "lucide-react";

import { RUN_STATUS_LABEL, type AgentRunStatus } from "@/lib/api/agents";
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

/** A run's status as a compact pill: bot icon plus "Working", "Failed", …. */
export function RunStatusBadge({
  status,
  name,
  className,
}: {
  status: AgentRunStatus;
  /** The agent's name, for the tooltip. */
  name?: string;
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
      <Bot className={cn("size-3", status === "RUNNING" && "animate-pulse")} aria-hidden />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

/** An agent in place of a person's avatar. */
export function AgentAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      aria-label={name}
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-chip", className)}
    >
      <Bot className="size-3 text-review" aria-hidden />
    </span>
  );
}

/** The card badge shows live and failed runs; finished or cancelled ones say nothing. */
export function cardRunStatus(runs: { status: AgentRunStatus }[] | undefined): AgentRunStatus | null {
  const status = runs?.[0]?.status;
  return status && status !== "DONE" && status !== "CANCELLED" ? status : null;
}

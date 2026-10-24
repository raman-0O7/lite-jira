import { Bookmark, Bug, CornerDownRight, SquareCheck, Zap } from "lucide-react";

import type { IssueType } from "@/lib/api/projects";
import { ISSUE_TYPE_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

const ICONS = {
  EPIC: { Icon: Zap, className: "text-violet-500" },
  STORY: { Icon: Bookmark, className: "text-emerald-600 dark:text-emerald-400" },
  TASK: { Icon: SquareCheck, className: "text-blue-600 dark:text-blue-400" },
  BUG: { Icon: Bug, className: "text-red-600 dark:text-red-400" },
  SUBTASK: { Icon: CornerDownRight, className: "text-muted-foreground" },
} as const;

export function IssueTypeIcon({ type, className }: { type: IssueType; className?: string }) {
  const { Icon, className: color } = ICONS[type];
  return (
    <Icon
      role="img"
      aria-label={ISSUE_TYPE_LABEL[type]}
      className={cn("size-3.5 shrink-0", color, className)}
    />
  );
}

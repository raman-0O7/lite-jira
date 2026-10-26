import { Bookmark, Bug, CornerDownRight, Zap } from "lucide-react";

import type { IssueType } from "@/lib/api/projects";
import { ISSUE_TYPE_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/** A rounded square with a check (lucide's SquareCheck, with the design's radius). */
function TaskGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="4" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const ICONS = {
  EPIC: { Icon: Zap, className: "text-review fill-review/20" },
  STORY: { Icon: Bookmark, className: "text-success fill-success-soft" },
  TASK: { Icon: TaskGlyph, className: "text-info" },
  BUG: { Icon: Bug, className: "text-danger" },
  SUBTASK: { Icon: CornerDownRight, className: "text-grey" },
} as const;

export function IssueTypeIcon({
  type,
  className,
  decorative,
}: {
  type: IssueType;
  className?: string;
  /** Hide from assistive tech when the type name is printed next to it. */
  decorative?: boolean;
}) {
  const { Icon, className: color } = ICONS[type];
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": ISSUE_TYPE_LABEL[type] };
  return <Icon strokeWidth={2.2} {...a11y} className={cn("size-[13px] shrink-0", color, className)} />;
}

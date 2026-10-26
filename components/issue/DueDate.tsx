import { format } from "date-fns";
import { CalendarDays } from "lucide-react";

import { dueStatus } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

const TONE = {
  overdue: "text-danger",
  soon: "text-warning",
  normal: "text-muted-foreground",
} as const;

/** A compact due date: red when overdue, amber when due within two days. */
export function DueDate({ value, className }: { value: string; className?: string }) {
  const due = new Date(value);
  const status = dueStatus(due);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-2xs font-medium tabular", TONE[status], className)}
      title={status === "overdue" ? "Overdue" : status === "soon" ? "Due soon" : "Due date"}
    >
      <CalendarDays className="size-3" />
      {format(due, "MMM d")}
    </span>
  );
}

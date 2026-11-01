import { Ban } from "lucide-react";

import { cn } from "@/lib/utils";

/** "Blocked" while open issues block this one; the tooltip names them (docs/features/22-my-work.md). */
export function BlockedChip({ blockedBy, className }: { blockedBy?: string[]; className?: string }) {
  if (!blockedBy?.length) return null;
  return (
    <span
      title={`Blocked by ${blockedBy.join(", ")}`}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] bg-destructive/10 px-1.5 text-2xs font-medium text-destructive",
        className,
      )}
    >
      <Ban className="size-3" />
      Blocked
    </span>
  );
}

import type { Priority } from "@/lib/api/projects";
import { PRIORITY_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

const BARS: Record<Exclude<Priority, "URGENT">, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Signal bars filled by level; urgent is an orange "!" tile. */
export function PriorityIcon({
  priority,
  className,
  decorative,
}: {
  priority: Priority;
  className?: string;
  /** Hide from assistive tech when the label is printed next to it. */
  decorative?: boolean;
}) {
  const label = `${PRIORITY_LABEL[priority]} priority`;
  const a11y = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  if (priority === "URGENT") {
    return (
      <span
        {...a11y}
        title={decorative ? undefined : label}
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-urgent text-[10px] leading-none font-extrabold text-[#1A0E00]",
          className,
        )}
      >
        !
      </span>
    );
  }
  const filled = BARS[priority];
  return (
    <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0 fill-icon", className)} {...a11y}>
      {!decorative ? <title>{label}</title> : null}
      <rect x="1.5" y="8" width="2.6" height="4" rx="1" />
      <rect x="5.7" y="5" width="2.6" height="7" rx="1" opacity={filled >= 2 ? 1 : 0.28} />
      <rect x="9.9" y="2" width="2.6" height="10" rx="1" opacity={filled >= 3 ? 1 : 0.28} />
    </svg>
  );
}

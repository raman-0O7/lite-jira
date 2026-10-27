import type { LabelStub } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

/**
 * A label pill: the label's color as a dot on a neutral chip, so any label
 * color reads in both themes. With `onRemove`, an "×" unassigns it.
 */
export function LabelChip({
  label,
  onRemove,
  className,
}: {
  label: LabelStub;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1.5 rounded-full bg-chip pr-2 pl-[7px] text-2xs font-medium text-soft",
        onRemove && "pr-1",
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      <span className="truncate">{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="grid size-3.5 shrink-0 place-items-center rounded-full leading-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

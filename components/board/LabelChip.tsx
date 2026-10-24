import type { LabelStub } from "@/lib/api/projects";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/task-meta";

/**
 * LabelChip — a single colored label tag.
 *
 * Used both on the card (label row slot) and in the modal's label picker. The
 * background is the label's own color; the text color is chosen for contrast.
 * When `onRemove` is provided, an inline "×" lets the user unassign the label.
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
        "inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium",
        className,
      )}
      style={{
        backgroundColor: label.color,
        color: readableTextColor(label.color),
      }}
    >
      <span className="truncate">{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 grid size-3.5 shrink-0 place-items-center rounded-full leading-none hover:bg-black/15"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

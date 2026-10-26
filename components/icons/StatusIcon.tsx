import type { StatusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Column status: dashed (to do), half (started), three-quarter (review), check (done). */
export function StatusIcon({
  variant,
  label,
  className,
}: {
  variant: StatusVariant;
  /** Accessible name, usually the column name. Omit when text sits next to it. */
  label?: string;
  className?: string;
}) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  const classes = cn("size-3.5 shrink-0", className);
  if (variant === "done") {
    return (
      <svg viewBox="0 0 14 14" className={classes} {...a11y}>
        <circle cx="7" cy="7" r="6" className="fill-success" />
        <path
          d="m4.4 7.2 1.8 1.8 3.4-3.6"
          fill="none"
          className="stroke-on-success"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (variant === "todo") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={classes} {...a11y}>
        <circle cx="7" cy="7" r="5.5" className="stroke-grey" strokeWidth="1.5" strokeDasharray="2.2 1.6" />
      </svg>
    );
  }
  const review = variant === "review";
  return (
    <svg viewBox="0 0 14 14" fill="none" className={classes} {...a11y}>
      <circle cx="7" cy="7" r="5.5" className={review ? "stroke-review" : "stroke-warning"} strokeWidth="1.5" />
      <path
        d={review ? "M7 7V3.5A3.5 3.5 0 1 1 3.5 7Z" : "M7 3.5A3.5 3.5 0 0 1 7 10.5Z"}
        className={review ? "fill-review" : "fill-warning"}
      />
    </svg>
  );
}

import { cn } from "@/lib/utils";

/** The Kanso mark: an open ensō circle on an accent tile. */
export function KansoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[62%]" aria-hidden="true">
        <path d="M19 7.5A8 8 0 1 0 20 13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

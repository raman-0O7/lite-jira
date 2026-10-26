import { colorFor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-4 rounded-[4px] text-[9px]",
  md: "size-5 rounded-[5px] text-[10px]",
  lg: "size-8 rounded-lg text-sm",
} as const;

/** A project's first letter on a color derived from its key. */
export function ProjectTile({
  projectKey,
  name,
  size = "sm",
  className,
}: {
  projectKey: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: colorFor(projectKey) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none font-bold text-white select-none",
        SIZES[size],
        className,
      )}
    >
      {(name.trim()[0] ?? projectKey[0] ?? "?").toUpperCase()}
    </span>
  );
}

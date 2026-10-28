import { cn } from "@/lib/utils"

/** A placeholder block that pulses while content loads. Decorative: wrap groups in `<Loading>`. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-track motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }

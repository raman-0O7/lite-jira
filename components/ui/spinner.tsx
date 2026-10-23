import { cn } from "@/lib/utils"

/** A three-quarter ring that spins. Sized by the parent's svg sizing rules. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        pathLength={100}
        strokeDasharray="75 100"
        className="origin-center -rotate-135"
      />
    </svg>
  )
}

export { Spinner }

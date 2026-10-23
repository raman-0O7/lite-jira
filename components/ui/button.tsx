import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

// The visible surface (background, border, shadow) lives on a ::before layer
// behind the content, so pressing scales the surface slightly while the label
// stays crisp. Variants paint that layer via `before:*` classes.
const buttonVariants = cva(
  [
    "group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-lg bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none",
    "transition-[color,box-shadow] duration-150 ease-out",
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:border-transparent",
    "before:transition-[scale,background-color,border-color,box-shadow] before:duration-150 before:ease-out motion-reduce:before:transition-none",
    "active:not-aria-[haspopup]:before:scale-[0.985] data-pressed:before:scale-[0.985] motion-reduce:active:before:scale-100",
    "focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none",
    "aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "text-primary-foreground before:bg-primary before:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.24)] hover:before:bg-primary/88",
        outline:
          "hover:text-foreground before:border-border before:bg-background hover:before:bg-muted aria-expanded:before:bg-muted dark:before:border-input dark:before:bg-input/30 dark:hover:before:bg-input/50",
        secondary:
          "text-secondary-foreground before:bg-secondary hover:before:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost:
          "hover:text-foreground hover:before:bg-muted aria-expanded:before:bg-muted dark:hover:before:bg-muted/50",
        destructive:
          "text-destructive before:bg-destructive/10 hover:before:bg-destructive/20 focus-visible:ring-destructive/20 dark:before:bg-destructive/20 dark:hover:before:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline before:hidden",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Both labels share one grid cell, so the button is always as wide as the
// longer label and swapping between them never shifts the layout.
const swapLabel =
  "inline-flex items-center gap-[inherit] whitespace-nowrap [grid-area:1/1] transition-[opacity,filter,translate] duration-150 ease-in-out motion-reduce:transition-none"

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  loadingText,
  children,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Show a spinner and block clicks without dimming the button. */
    loading?: boolean
    /** Label shown while loading, e.g. "Saving…". Defaults to the normal label. */
    loadingText?: React.ReactNode
  }) {
  const classes = cn(buttonVariants({ variant, size, className }))

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={classes}
        onClick={onClick}
        {...props}
      >
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      className={classes}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...props}
    >
      <span className="grid items-center justify-items-center gap-[inherit]">
        <span
          aria-hidden={loading || undefined}
          className={cn(
            swapLabel,
            loading && "-translate-y-1 opacity-0 blur-[2px]"
          )}
        >
          {children}
        </span>
        {(loading || loadingText !== undefined) && (
          <span
            aria-hidden={!loading || undefined}
            className={cn(
              swapLabel,
              !loading && "pointer-events-none translate-y-1 opacity-0 blur-[2px]"
            )}
          >
            <Spinner className={loading ? undefined : "animate-none"} />
            {loadingText ?? children}
          </span>
        )}
      </span>
    </button>
  )
}

export { Button, buttonVariants }

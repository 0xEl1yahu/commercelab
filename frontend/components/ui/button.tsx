import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Direction A: every button is a pill. `default` is the accent-blue primary action
// (Add to bag, Check out, Pay); `ink` is the filled dark pill; `secondary` sits on
// white as a pale-grey pill; `link` is an accent text link.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-pill border border-transparent bg-clip-padding font-normal whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-150 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-[#0077ed] active:bg-[#006edb]",
        ink: "bg-ink text-white hover:bg-ink-2",
        outline:
          "border-input bg-white text-ink hover:bg-surface aria-expanded:bg-surface",
        secondary:
          "bg-surface text-ink hover:bg-[#ebebef] aria-expanded:bg-[#ebebef]",
        ghost: "text-ink hover:bg-surface aria-expanded:bg-surface",
        destructive:
          "bg-danger/10 text-danger hover:bg-danger/15 focus-visible:ring-danger/20",
        link: "h-auto rounded-none px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-4 text-callout",
        xs: "h-6 gap-1 px-2.5 text-caption [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-footnote [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-7 text-body",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

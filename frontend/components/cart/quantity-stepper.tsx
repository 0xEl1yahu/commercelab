"use client";

import { MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Names the product for screen readers: "Increase quantity of {label}". */
  label?: string;
  size?: "md" | "sm";
  className?: string;
};

/** A pill with − and + around the quantity. The bounds are conveniences; the quote decides. */
export function QuantityStepper({ value, min, max, onChange, label, size = "md", className }: Props) {
  const suffix = label ? ` of ${label}` : "";
  const small = size === "sm";
  const button = cn(
    "inline-flex shrink-0 items-center justify-center rounded-pill text-ink outline-none transition-colors",
    "hover:bg-black/[0.06] focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30",
    small ? "size-11 sm:size-8" : "size-11",
  );

  return (
    <div
      role="group"
      aria-label={label ? `Quantity of ${label}` : "Quantity"}
      className={cn(
        "inline-flex items-center rounded-pill bg-surface",
        small ? "h-11 sm:h-8" : "h-11",
        className,
      )}
    >
      <button
        type="button"
        className={button}
        aria-label={`Decrease quantity${suffix}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon className={small ? "size-3.5" : "size-4"} strokeWidth={2} />
      </button>
      <span
        data-testid="quantity"
        aria-live="polite"
        className={cn(
          "grow text-center font-medium tabular-nums text-ink",
          small ? "min-w-7 text-footnote" : "min-w-9 text-callout",
        )}
      >
        {value}
      </span>
      <button
        type="button"
        className={button}
        aria-label={`Increase quantity${suffix}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon className={small ? "size-3.5" : "size-4"} strokeWidth={2} />
      </button>
    </div>
  );
}

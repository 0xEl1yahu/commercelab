import { cn } from "@/lib/utils";
import type { ProductCard } from "@/lib/types";

type Props = {
  status: ProductCard["stock_status"];
  /** stock_left from the API: set only for low_stock. */
  left: number | null | undefined;
  className?: string;
};

// The band comes from the backend (the threshold is a stock rule); this only labels it.
const DOT: Record<Props["status"], string> = {
  in_stock: "bg-ok",
  low_stock: "bg-low",
  out_of_stock: "bg-danger",
};

export function stockLabel(status: Props["status"], left: number | null | undefined): string {
  if (status === "in_stock") return "In stock";
  if (status === "out_of_stock") return "Out of stock";
  return left == null ? "Only a few left" : `Only ${left} left`;
}

/** A coloured dot and the stock label: "In stock", "Only 2 left", "Out of stock". */
export function StockBadge({ status, left, className }: Props) {
  return (
    <span
      data-testid="stock-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-caption whitespace-nowrap",
        status === "out_of_stock" ? "text-muted" : "text-ink-2",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[status])} />
      {stockLabel(status, left)}
    </span>
  );
}

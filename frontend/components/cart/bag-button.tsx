"use client";

import { useCart } from "./cart-provider";

/** "Bag" and the quoted item count; opens the bag drawer. */
export function BagButton() {
  const { count, open } = useCart();
  const label = count === 1 ? "Bag, 1 item" : `Bag, ${count} items`;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={label}
      aria-haspopup="dialog"
      className="-mr-2 inline-flex h-9 items-center gap-2 rounded-pill px-2 text-footnote text-ink transition-colors hover:text-ink-2"
    >
      <BagGlyph />
      <span>Bag</span>
      <span
        data-testid="bag-count"
        className={
          count > 0
            ? "inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-ink px-1.5 text-caption font-medium tabular-nums text-white"
            : "inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-surface px-1.5 text-caption tabular-nums text-muted"
        }
      >
        {count}
      </span>
    </button>
  );
}

function BagGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
      <path
        d="M3.2 5.5h9.6l-.7 8.1a1 1 0 0 1-1 .9H4.9a1 1 0 0 1-1-.9L3.2 5.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.8 5.5V4.4a2.2 2.2 0 0 1 4.4 0v1.1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

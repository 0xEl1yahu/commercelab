"use client";

// The bag's state for the whole app. Lines live in localStorage; everything shown
// (prices, totals, how many can be bought) comes from POST /api/cart/quote, which
// is re-asked 250 ms after the last change.
//
// Contract notes for the screens:
// - `quote` is null until the first quote for a non-empty bag arrives, and null
//   whenever the bag is empty. Show "Your bag is empty." from `lines.length === 0`.
// - `ready` turns true once the saved bag has been read after mount. Before that,
//   `lines` is [] only because nothing has been read yet.
// - `quoting` is true from a change until the quote for it has arrived (or failed),
//   so a screen can wait for the re-quote before trusting `quote`'s numbers.
// - `count` sums the quoted quantities, so a sold-out line counts 0.
// - `notices[product_id]` says the server cut that line (from -> to). A notice stays
//   until the shopper edits that line or closes the drawer.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  CART_STORAGE_KEY,
  addLine,
  applyQuote,
  parseCart,
  removeLine,
  setQuantity as setLineQuantity,
  toQuoteRequest,
  type CartLine,
} from "@/lib/cart";
import type { CartQuote } from "@/lib/types";

export const QUOTE_DEBOUNCE_MS = 250;

export type CartNotice = { from: number; to: number };

export type CartContextValue = {
  lines: CartLine[];
  quote: CartQuote | null;
  count: number;
  notices: Record<number, CartNotice>;
  hasSoldOut: boolean;
  lastAdded: number | null;
  isOpen: boolean;
  ready: boolean;
  quoting: boolean;
  add: (product_id: number, qty?: number) => void;
  setQuantity: (product_id: number, qty: number) => void;
  remove: (product_id: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function readSaved(): CartLine[] {
  try {
    return parseCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return []; // storage blocked (private mode, permissions)
  }
}

function save(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Storage full or blocked: the bag still works for this visit.
  }
}

function withoutNotice(notices: Record<number, CartNotice>, product_id: number) {
  if (!(product_id in notices)) return notices;
  const next = { ...notices };
  delete next[product_id];
  return next;
}

const keyOf = (lines: CartLine[]) => JSON.stringify(lines);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [notices, setNotices] = useState<Record<number, CartNotice>>({});
  const [lastAdded, setLastAdded] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [quoting, setQuoting] = useState(false);

  // The lines the current quote describes; a change to anything else re-quotes.
  const quotedKey = useRef<string>(keyOf([]));
  // Only the newest request may update state: older answers arrive stale.
  const requestSeq = useRef(0);

  // Read the saved bag once, after mount (localStorage doesn't exist on the server).
  useEffect(() => {
    const saved = readSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading external storage after hydration
    setLines(saved);
    setReady(true);
  }, []);

  // Write on change.
  useEffect(() => {
    if (ready) save(lines);
  }, [lines, ready]);

  // Re-quote 250 ms after the last change.
  useEffect(() => {
    if (!ready) return;
    const key = keyOf(lines);
    const seq = ++requestSeq.current; // any answer still in flight is now stale
    if (key === quotedKey.current) {
      // Back to what the current quote describes (e.g. + then − within 250 ms).
      setQuoting(false);
      return;
    }
    if (lines.length === 0) {
      quotedKey.current = key;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an empty bag needs no quote
      setQuote(null);
      setQuoting(false);
      return;
    }

    setQuoting(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(toQuoteRequest(lines)),
        });
        if (!res.ok) throw new Error(`cart quote failed: ${res.status}`);
        const next = (await res.json()) as CartQuote;
        if (seq !== requestSeq.current) return;

        const applied = applyQuote(lines, next);
        // This quote already describes the corrected lines (its quantities and totals
        // are the clamped ones, and removed ids are not in it), so no second request.
        quotedKey.current = keyOf(applied.lines);
        setQuote(next);
        if (applied.adjusted.length > 0 || applied.lines.length !== lines.length) {
          setLines(applied.lines);
        }
        if (applied.adjusted.length > 0) {
          setNotices((current) => {
            const merged = { ...current };
            for (const { product_id, from, to } of applied.adjusted) merged[product_id] = { from, to };
            return merged;
          });
        }
        setQuoting(false);
      } catch {
        // Network or server trouble: keep the last quote; the next change asks again.
        if (seq === requestSeq.current) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [lines, ready]);

  const add = useCallback((product_id: number, qty = 1) => {
    setLines((current) => addLine(current, product_id, qty));
    setNotices((current) => withoutNotice(current, product_id));
    setLastAdded(product_id);
  }, []);

  const setQuantity = useCallback((product_id: number, qty: number) => {
    setLines((current) => setLineQuantity(current, product_id, qty));
    setNotices((current) => withoutNotice(current, product_id));
  }, []);

  const remove = useCallback((product_id: number) => {
    setLines((current) => removeLine(current, product_id));
    setNotices((current) => withoutNotice(current, product_id));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setNotices({});
    setLastAdded(null);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    setNotices({});
    setLastAdded(null);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const quoted = quote?.lines ?? [];
    return {
      lines,
      quote,
      count: quoted.reduce((sum, line) => sum + line.quantity, 0),
      notices,
      hasSoldOut: quoted.some((line) => line.quantity === 0),
      lastAdded,
      isOpen,
      ready,
      quoting,
      add,
      setQuantity,
      remove,
      clear,
      open,
      close,
    };
  }, [lines, quote, notices, lastAdded, isOpen, ready, quoting, add, setQuantity, remove, clear, open, close]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (value === null) throw new Error("useCart() must be used inside <CartProvider>");
  return value;
}

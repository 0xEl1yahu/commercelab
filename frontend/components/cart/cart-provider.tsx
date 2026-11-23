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
// - `quoting` is true from a change until the quote for it has arrived, or until
//   every retry has failed, so a screen can wait for the re-quote before trusting
//   `quote`'s numbers.
// - A failed quote is retried after 1 s, 2 s and 4 s while the lines stay the same.
//   If all of those fail, `quoteFailed` is true (and `quote` is the last good one,
//   possibly for other lines) until a quote succeeds or the lines change. open()
//   asks again whenever the quote doesn't describe the current lines.
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
export const QUOTE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

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
  quoteFailed: boolean;
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
  const [quoteFailed, setQuoteFailed] = useState(false);
  // Bumped by open() to ask again for the same lines after the retries ran out.
  const [requoteToken, setRequoteToken] = useState(0);

  // The newest lines, readable synchronously by the actions.
  const linesRef = useRef<CartLine[]>([]);
  const quotingRef = useRef(false);
  const commitLines = useCallback((next: CartLine[]) => {
    linesRef.current = next;
    setLines(next);
  }, []);

  // The lines the current quote describes; a change to anything else re-quotes.
  const quotedKey = useRef<string>(keyOf([]));
  // Only the newest request may update state: older answers arrive stale.
  const requestSeq = useRef(0);

  // Read the saved bag once, after mount (localStorage doesn't exist on the server).
  useEffect(() => {
    const saved = readSaved();
    linesRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading external storage after hydration
    setLines(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    quotingRef.current = quoting;
  }, [quoting]);

  // Write on change.
  useEffect(() => {
    if (ready) save(lines);
  }, [lines, ready]);

  // Re-quote 250 ms after the last change, retrying after 1 s, 2 s and 4 s.
  useEffect(() => {
    if (!ready) return;
    const key = keyOf(lines);
    const seq = ++requestSeq.current; // any answer still in flight is now stale
    if (key === quotedKey.current) {
      // Back to what the current quote describes (e.g. + then − within 250 ms).
      setQuoting(false);
      setQuoteFailed(false);
      return;
    }
    if (lines.length === 0) {
      quotedKey.current = key;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an empty bag needs no quote
      setQuote(null);
      setQuoting(false);
      setQuoteFailed(false);
      return;
    }

    setQuoting(true);
    setQuoteFailed(false);
    let cancelled = false;
    let timer: number | undefined;
    const stale = () => cancelled || seq !== requestSeq.current;

    const attempt = async (retry: number) => {
      try {
        const res = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(toQuoteRequest(lines)),
        });
        if (!res.ok) throw new Error(`cart quote failed: ${res.status}`);
        const next = (await res.json()) as CartQuote;
        if (stale()) return;

        const applied = applyQuote(lines, next);
        // This quote already describes the corrected lines (its quantities and totals
        // are the clamped ones, and removed ids are not in it), so no second request.
        quotedKey.current = keyOf(applied.lines);
        setQuote(next);
        if (applied.adjusted.length > 0 || applied.lines.length !== lines.length) {
          commitLines(applied.lines);
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
        // Network or server trouble: keep the last quote and try again, same lines.
        if (stale()) return;
        if (retry < QUOTE_RETRY_DELAYS_MS.length) {
          timer = window.setTimeout(() => void attempt(retry + 1), QUOTE_RETRY_DELAYS_MS[retry]);
        } else {
          setQuoting(false);
          setQuoteFailed(true);
        }
      }
    };

    timer = window.setTimeout(() => void attempt(0), QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lines, ready, requoteToken, commitLines]);

  /** Applies an edit to the newest lines; returns whether anything changed. */
  const edit = useCallback(
    (product_id: number, change: (current: CartLine[]) => CartLine[]): boolean => {
      const current = linesRef.current;
      const next = change(current);
      if (keyOf(next) === keyOf(current)) return false;
      commitLines(next);
      setNotices((notices) => withoutNotice(notices, product_id));
      return true;
    },
    [commitLines],
  );

  const add = useCallback(
    (product_id: number, qty = 1) => {
      // A 51st line, or a line already at 100, changes nothing: nothing was "added".
      if (edit(product_id, (current) => addLine(current, product_id, qty))) setLastAdded(product_id);
    },
    [edit],
  );

  const setQuantity = useCallback(
    (product_id: number, qty: number) => {
      edit(product_id, (current) => setLineQuantity(current, product_id, qty));
    },
    [edit],
  );

  const remove = useCallback(
    (product_id: number) => {
      edit(product_id, (current) => removeLine(current, product_id));
    },
    [edit],
  );

  const clear = useCallback(() => {
    commitLines([]);
    setNotices({});
    setLastAdded(null);
  }, [commitLines]);

  const open = useCallback(() => {
    setIsOpen(true);
    // Ask again if the quote doesn't describe these lines and nothing is on its way
    // (the retries ran out, or the quote never arrived).
    if (keyOf(linesRef.current) !== quotedKey.current && !quotingRef.current) {
      setRequoteToken((token) => token + 1);
    }
  }, []);

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
      quoteFailed,
      add,
      setQuantity,
      remove,
      clear,
      open,
      close,
    };
  }, [lines, quote, notices, lastAdded, isOpen, ready, quoting, quoteFailed, add, setQuantity, remove, clear, open, close]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (value === null) throw new Error("useCart() must be used inside <CartProvider>");
  return value;
}

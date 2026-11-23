"use client";

// The one-page checkout: contact, delivery address and card on the left, the quoted
// bag on the right, and what happens after Pay.
//
// Retry safety, in short:
// - One request at a time: a ref is set before the first await, so a double click
//   can't send twice.
// - Each request carries the attempt key for its exact body (lib/checkout-attempt):
//   the same body reuses the key (a retry, a reload), a declined one gets a new key.
// - While an outcome is uncertain (no answer, or the provider hasn't replied), the
//   attempt is locked: contact and address are read-only, and Pay re-sends the stored
//   request exactly as it was, with its key, never one rebuilt from today's form and
//   bag. The lock is kept in the tab's storage, so a reload or a visit elsewhere
//   comes back to the same locked attempt (and resumes checking a pending order).
// - Card fields are validated here and never sent: they have no `name`, and the
//   request body is built by toCheckoutRequest, which copies named fields only.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";

import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import {
  attemptKey,
  attemptStorage,
  clearAttempt,
  fingerprint,
  markDeclined,
  markSettled,
  markUncertain,
  uncertainAttempt,
  type AttemptStorage,
} from "@/lib/checkout-attempt";
import { toQuoteRequest, type CartLine } from "@/lib/cart";
import {
  interpretCheckoutResponse,
  payBlocker,
  quoteDescribes,
  quoteMatchesExactly,
  type Outcome,
} from "@/lib/checkout-outcome";
import { recheckUntilKnown, stillUnknown } from "@/lib/checkout-recheck";
import {
  EMPTY_CARD_FORM,
  EMPTY_CHECKOUT_FORM,
  FIELD_ORDER,
  INVALID_FIELD_MESSAGE,
  formatCardNumber,
  formatExpiry,
  formatSecurityCode,
  toCheckoutRequest,
  validateCheckout,
  validateField,
  type CardForm,
  type CheckoutField,
  type CheckoutForm as CheckoutFormValues,
  type FieldErrors,
} from "@/lib/checkout-schema";
import { formatGBP } from "@/lib/money";
import type { CartQuote, CheckoutRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AwaitingPanel } from "./awaiting-panel";
import { OrderSummary, type StockWarning } from "./order-summary";

type Message = { tone: "danger" | "notice"; text: string; detail?: string };

type Awaiting = { token: string; reference: string; exhausted: boolean; checking: boolean };

type SentRequest = { body: CheckoutRequest; key: string };

const MESSAGES = {
  retryable: "Something went wrong. Your order wasn't placed twice — press Pay to try again.",
  locked: "Your details are locked so a retry can't create a second order.",
  conflict: "Your bag changed while you were paying. Please press Pay again.",
  stock: "Your bag has changed. Check the total, then pay again.",
  unavailable: "An item in your bag is no longer sold. Reload the page to update your bag.",
  checkDetails: "Please check your details and try again.",
} as const;

const CARD_FIELDS: CheckoutField[] = ["number", "expiry", "securityCode"];

/** Sends one checkout request. Never throws: a network failure is status 0. */
async function postCheckout({ body, key }: SentRequest): Promise<Outcome> {
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    status = res.status;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  } catch {
    status = 0;
  }
  return interpretCheckoutResponse(status, json);
}

const QUOTE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/**
 * POST /api/cart/quote for these items, retried after 1 s, 2 s and 4 s. Null if
 * every try failed (or `cancelled()` turned true): the summary then shows no prices.
 */
async function fetchQuote(items: CartLine[], cancelled: () => boolean): Promise<CartQuote | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch("/api/cart/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toQuoteRequest(items)),
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as CartQuote;
    } catch {
      // Network trouble: try again below.
    }
    if (cancelled() || attempt >= QUOTE_RETRY_DELAYS_MS.length) return null;
    await new Promise((resolve) => setTimeout(resolve, QUOTE_RETRY_DELAYS_MS[attempt]));
    if (cancelled()) return null;
  }
}

/** The same products at the same quantities, in any order. */
function sameItems(items: CartLine[], lines: CartLine[]): boolean {
  return (
    items.length === lines.length &&
    items.every((item) => lines.some((l) => l.product_id === item.product_id && l.quantity === item.quantity))
  );
}

/** The form values a stored request was built from, or null if it isn't one of ours. */
function formFromBody(body: unknown): CheckoutFormValues | null {
  if (body === null || typeof body !== "object") return null;
  const { contact, address, items } = body as Record<string, unknown>;
  if (!contact || typeof contact !== "object" || !address || typeof address !== "object") return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const c = contact as Record<string, unknown>;
  const a = address as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    email: text(c.email),
    name: text(c.name),
    phone: text(c.phone),
    company: text(a.company),
    vat_number: text(a.vat_number),
    line1: text(a.line1),
    line2: text(a.line2),
    city: text(a.city),
    postcode: text(a.postcode),
  };
}

const inputId = (field: CheckoutField | "country") => `checkout-${field}`;

function focusField(field: CheckoutField): void {
  document.getElementById(inputId(field))?.focus();
}

function firstField(errors: FieldErrors): CheckoutField | undefined {
  return FIELD_ORDER.find((field) => errors[field] !== undefined);
}

export function CheckoutForm() {
  const cart = useCart();
  const router = useRouter();

  const [form, setForm] = useState<CheckoutFormValues>(EMPTY_CHECKOUT_FORM);
  const [card, setCard] = useState<CardForm>(EMPTY_CARD_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [checked, setChecked] = useState(false); // Pay was pressed: re-check fields as they change
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [declined, setDeclined] = useState(false);
  // The uncertain attempt Pay must re-send as it is; null when nothing is locked.
  const [lockedRequest, setLockedRequest] = useState<SentRequest | null>(null);
  const [stockWarning, setStockWarning] = useState<StockWarning | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [placed, setPlaced] = useState(false);
  // The quote for the locked request's own items (not today's bag), once it arrives.
  const [lockedQuote, setLockedQuote] = useState<{ for: SentRequest; quote: CartQuote | null } | null>(null);
  const [lockedQuoteTry, setLockedQuoteTry] = useState(0);
  const locked = lockedRequest !== null;
  const lockedSummary = lockedQuote !== null && lockedQuote.for === lockedRequest ? lockedQuote : null;

  // The newest cart, for answers that arrive after a re-render (re-check runs).
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  });

  const inFlight = useRef(false);
  const lastSent = useRef<SentRequest | null>(null);
  const storageRef = useRef<AttemptStorage | null>(null);
  const mounted = useRef(true);
  const recheckRun = useRef(0); // bumped to stop an older automatic re-check run
  const resumed = useRef(false);
  const pendingFocus = useRef<"message" | "declined" | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const declinedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After an outcome, move focus to what it says (so it isn't left on <body>).
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    (target === "declined" ? declinedRef : messageRef).current?.focus();
  });

  const storage = useCallback((): AttemptStorage => {
    storageRef.current ??= attemptStorage();
    return storageRef.current;
  }, []);

  const blocker = payBlocker({
    ready: cart.ready,
    lines: cart.lines,
    quote: cart.quote,
    quoting: cart.quoting,
    quoteFailed: cart.quoteFailed,
    hasSoldOut: cart.hasSoldOut,
    submitting,
    locked,
    lockedQuoting: locked && lockedSummary === null,
    // The earlier order's own quote failed every try: no price, so no Pay.
    lockedQuoteFailed: locked && lockedSummary !== null && lockedSummary.quote === null,
  });
  const stale = locked
    ? lockedSummary === null || lockedSummary.quote === null
    : cart.quoting || cart.quoteFailed || (cart.quote !== null && !quoteDescribes(cart.lines, cart.quote));

  // While locked, ask for a quote of exactly the request Pay will re-send, so the
  // summary and the Pay label describe that request, not today's bag (which may have
  // changed in another tab, or been cut because the earlier order holds the stock).
  // `lockedQuoteTry` is bumped by "Try again" after every try failed.
  useEffect(() => {
    if (lockedRequest === null) return;
    let cancelled = false;
    void (async () => {
      const quote = await fetchQuote(lockedRequest.body.items, () => cancelled);
      if (!cancelled) setLockedQuote({ for: lockedRequest, quote });
    })();
    return () => {
      cancelled = true;
    };
  }, [lockedRequest, lockedQuoteTry]);

  // --- what each answer does -------------------------------------------------------

  const settle = useCallback(() => {
    inFlight.current = false;
    setSubmitting(false);
  }, []);

  const lock = useCallback((sent: SentRequest) => {
    lastSent.current = sent;
    setLockedRequest(sent);
  }, []);

  const handleOutcome = useCallback(
    (outcome: Outcome, sent: SentRequest): void => {
      if (!mounted.current) return;
      switch (outcome.kind) {
        case "paid": {
          // Stay "in flight": nothing more may be sent from this page.
          recheckRun.current += 1;
          clearAttempt(storage());
          setPlaced(true);
          // Empty the bag only of what was ordered. A retried earlier request may
          // differ from today's bag (changed in another tab): those lines stay.
          const lines = cartRef.current.lines;
          if (sameItems(sent.body.items, lines)) {
            cart.clear();
          } else {
            for (const item of sent.body.items) {
              const line = lines.find((l) => l.product_id === item.product_id);
              // The same line, or the same line cut because this order held the stock.
              if (line !== undefined && line.quantity <= item.quantity) cart.remove(item.product_id);
            }
          }
          router.replace(`/orders/${outcome.token}`);
          return;
        }

        case "declined":
          markDeclined(storage());
          setAwaiting(null);
          setLockedRequest(null);
          setDeclined(true);
          pendingFocus.current = "declined";
          settle();
          return;

        case "awaiting":
          markUncertain(storage(), { token: outcome.token, reference: outcome.reference });
          lock(sent);
          setAwaiting((current) => ({
            token: outcome.token,
            reference: outcome.reference,
            exhausted: current?.exhausted ?? false,
            checking: false,
          }));
          settle();
          return;

        case "stock": {
          // Nothing was made (the same key would have returned the order), so the
          // attempt is settled; the body changes, so the next Pay gets a new key.
          markSettled(storage());
          const line = cartRef.current.quote?.lines.find((l) => l.product.id === outcome.product_id);
          const item = sent.body.items.find((i) => i.product_id === outcome.product_id);
          setAwaiting(null);
          setLockedRequest(null);
          setStockWarning({
            product_id: outcome.product_id,
            name: line?.product.name ?? "This item",
            from: item?.quantity ?? line?.requested ?? outcome.available,
            available: outcome.available,
          });
          setMessage({ tone: "notice", text: MESSAGES.stock });
          pendingFocus.current = "message";
          cart.setQuantity(outcome.product_id, outcome.available);
          settle();
          return;
        }

        case "conflict":
          clearAttempt(storage());
          setAwaiting(null);
          setLockedRequest(null);
          setMessage({ tone: "danger", text: MESSAGES.conflict });
          pendingFocus.current = "message";
          settle();
          return;

        case "invalid": {
          markSettled(storage());
          setAwaiting(null);
          setLockedRequest(null);
          const fieldErrors: FieldErrors = {};
          for (const path of Object.keys(outcome.fields)) {
            const [group, field] = path.split(".");
            if ((group === "contact" || group === "address") && field in INVALID_FIELD_MESSAGE) {
              const name = field as keyof typeof INVALID_FIELD_MESSAGE;
              fieldErrors[name] = INVALID_FIELD_MESSAGE[name];
            }
          }
          const first = firstField(fieldErrors);
          if (first !== undefined) {
            setErrors((current) => ({ ...current, ...fieldErrors }));
            setChecked(true);
            setMessage({ tone: "danger", text: outcome.message });
            settle();
            window.requestAnimationFrame(() => focusField(first));
          } else {
            // No form field to point at. A string detail means something in the bag
            // can't be sold (the backend's ProductUnavailable), and its text is written
            // for developers, so the shopper gets plain words instead.
            const aboutTheBag = Object.keys(outcome.fields).length === 0;
            setMessage({ tone: "danger", text: aboutTheBag ? MESSAGES.unavailable : MESSAGES.checkDetails });
            pendingFocus.current = "message";
            settle();
          }
          return;
        }

        case "retryable":
          // The order may or may not exist. Keep the key and lock the request, so the
          // next Pay (even after a reload) re-sends exactly this one.
          markUncertain(storage(), {});
          lock(sent);
          setMessage({ tone: "danger", text: MESSAGES.retryable, detail: MESSAGES.locked });
          pendingFocus.current = "message";
          settle();
          return;
      }
    },
    [cart, router, settle, storage, lock],
  );

  const send = useCallback(async (sent: SentRequest): Promise<Outcome> => {
    inFlight.current = true;
    setSubmitting(true);
    lastSent.current = sent;
    return postCheckout(sent);
  }, []);

  // --- awaiting: re-send the same request and key ---------------------------------

  /** Re-sends the locked request with its key and returns what the answer means. */
  const resend = useCallback(async (): Promise<Outcome> => {
    const sent = lastSent.current;
    if (sent === null || inFlight.current) return { kind: "retryable" };
    setAwaiting((current) => current && { ...current, checking: true });
    const outcome = await send(sent);
    if (mounted.current && stillUnknown(outcome)) {
      // Still no answer from the provider: keep waiting, same request, same key.
      if (outcome.kind === "awaiting") {
        markUncertain(storage(), { token: outcome.token, reference: outcome.reference });
      }
      settle();
      setAwaiting((current) => current && { ...current, checking: false });
    }
    return outcome;
  }, [send, settle, storage]);

  /** After 2 s, 4 s and 8 s, then "Check again now". */
  const startAwaiting = useCallback(async () => {
    const run = ++recheckRun.current;
    const active = () => mounted.current && run === recheckRun.current;
    const result = await recheckUntilKnown({ send: resend, active });
    if (!active() || lastSent.current === null) return;
    if (result.status === "resolved") handleOutcome(result.outcome, lastSent.current);
    else if (result.status === "exhausted") {
      setAwaiting((current) => current && { ...current, exhausted: true });
    }
  }, [resend, handleOutcome]);

  const checkAgainNow = useCallback(async () => {
    const outcome = await resend();
    if (!stillUnknown(outcome) && lastSent.current !== null) handleOutcome(outcome, lastSent.current);
  }, [resend, handleOutcome]);

  // A reload (or a visit elsewhere and back) during an uncertain attempt: restore it,
  // locked, from the tab's storage. A pending order resumes its re-checks; otherwise
  // the shopper sees the retry message and Pay re-sends the stored request.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = uncertainAttempt<CheckoutRequest>(storage());
    if (pending === null) return;
    const restored = formFromBody(pending.body);
    if (restored === null) {
      clearAttempt(storage()); // not a request this page wrote
      return;
    }
    const sent = { body: pending.body, key: pending.key };
    setForm(restored);
    lock(sent);
    if (pending.token) {
      setAwaiting({ token: pending.token, reference: pending.reference ?? "", exhausted: false, checking: false });
      void startAwaiting();
    } else {
      setMessage({ tone: "danger", text: MESSAGES.retryable, detail: MESSAGES.locked });
    }
  }, [storage, lock, startAwaiting]);

  // --- Pay ------------------------------------------------------------------------

  const pay = useCallback(async () => {
    if (inFlight.current || blocker !== null) return;

    const result = validateCheckout(form, card);
    // While locked, contact and address can't be edited (they are the stored
    // request's), so only the card fields can stop the re-send.
    const problems: FieldErrors = {};
    if (!result.ok) {
      for (const [field, error] of Object.entries(result.errors) as [CheckoutField, string][]) {
        if (!locked || CARD_FIELDS.includes(field)) problems[field] = error;
      }
    }
    setChecked(true);
    const first = firstField(problems);
    if (first !== undefined) {
      setErrors(problems);
      focusField(first);
      return;
    }
    setErrors({});
    setMessage(null);
    setDeclined(false);
    setStockWarning(null);

    let sent: SentRequest;
    if (lockedRequest !== null) {
      // An uncertain attempt: the same request, byte for byte, with the same key.
      sent = lockedRequest;
    } else {
      const body = toCheckoutRequest(form, cart.lines);
      sent = { body, key: attemptKey(storage(), fingerprint(body)) };
    }
    const outcome = await send(sent);
    handleOutcome(outcome, sent);
    if (outcome.kind === "awaiting" && mounted.current) void startAwaiting();
  }, [blocker, form, card, locked, lockedRequest, cart.lines, storage, send, handleOutcome, startAwaiting]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void pay();
  };

  // --- fields ---------------------------------------------------------------------

  const recheckField = (field: CheckoutField, nextForm: CheckoutFormValues, nextCard: CardForm) => {
    if (!checked) return;
    setErrors((current) => {
      const message = validateField(field, nextForm, nextCard);
      if (current[field] === message) return current;
      const next = { ...current };
      if (message === undefined) delete next[field];
      else next[field] = message;
      return next;
    });
  };

  const onDetail = (field: keyof CheckoutFormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    if (locked) return;
    const next = { ...form, [field]: event.target.value };
    setForm(next);
    recheckField(field, next, card);
  };

  const onCard = (field: keyof CardForm) => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const value =
      field === "number" ? formatCardNumber(raw) : field === "expiry" ? formatExpiry(raw) : formatSecurityCode(raw);
    const next = { ...card, [field]: value };
    setCard(next);
    recheckField(field, form, next);
  };

  const switchCard = () => {
    setCard(EMPTY_CARD_FORM);
    setErrors((current) => {
      const next = { ...current };
      delete next.number;
      delete next.expiry;
      delete next.securityCode;
      return next;
    });
    setDeclined(false);
    focusField("number");
  };

  /**
   * The owner's escape hatch, offered only for a locked attempt with no order named
   * (no answer ever came back): forget it, unlock the form, and let the next Pay be
   * a new attempt with a new key. The copy says plainly what that risks.
   */
  const startNewOrder = () => {
    recheckRun.current += 1;
    clearAttempt(storage());
    lastSent.current = null;
    setLockedRequest(null);
    setMessage(null);
    window.requestAnimationFrame(() => focusField("email"));
  };

  const retryQuote = () => {
    if (locked) {
      // Ask again for the earlier order's own quote (Pay waits for it).
      setLockedQuote(null);
      setLockedQuoteTry((n) => n + 1);
      return;
    }
    // open() asks for a new quote when the last one failed; close() straight away so
    // the bag drawer never shows over the checkout.
    cart.open();
    cart.close();
  };

  // --- render ---------------------------------------------------------------------

  if (placed) {
    return (
      <CheckoutShell>
        <div role="status" className="flex items-center gap-3 py-16 text-callout text-ink-2">
          <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" />
          Payment received. Opening your order…
        </div>
      </CheckoutShell>
    );
  }

  if (!cart.ready) {
    return <CheckoutShell>{null}</CheckoutShell>;
  }

  if (cart.lines.length === 0 && !locked) {
    return (
      <section className="shop-container flex flex-1 flex-col items-center justify-center py-24 text-center">
        <h1 className="headline text-title-2">Your bag is empty.</h1>
        <p className="mt-3 text-callout text-ink-2">Add something to your bag, then come back to check out.</p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/">Continue shopping</Link>
        </Button>
      </section>
    );
  }

  // The summary and the total on Pay describe what Pay will send: while locked, the
  // stored request (priced by its own quote, and only when that prices it exactly);
  // otherwise today's bag.
  const showRequest = lockedRequest !== null;
  // Until the request's own quote arrives, today's bag quote stands in only if it
  // prices exactly the same items (so the summary doesn't blink empty after a
  // failure in this visit).
  const interimQuote =
    showRequest && cart.quote !== null && quoteMatchesExactly(lockedRequest.body.items, cart.quote)
      ? cart.quote
      : null;
  const summaryQuote = showRequest ? (lockedSummary?.quote ?? interimQuote) : cart.quote;
  let total: string | null = null;
  if (showRequest) {
    const quote = lockedSummary?.quote ?? null;
    if (quote !== null && quoteMatchesExactly(lockedRequest.body.items, quote)) total = formatGBP(quote.total);
  } else if (cart.quote !== null && !cart.quoting && quoteDescribes(cart.lines, cart.quote)) {
    total = formatGBP(cart.quote.total);
  }

  return (
    <CheckoutShell>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div className="lg:sticky lg:top-[76px] lg:col-start-2 lg:row-start-1 lg:self-start">
          <OrderSummary
            quote={summaryQuote}
            request={showRequest ? lockedRequest.body.items : undefined}
            stale={stale}
            notices={cart.notices}
            stockWarning={stockWarning}
            canRemove={!submitting && !locked && awaiting === null}
            onRemove={cart.remove}
          />
        </div>

        <div className="lg:col-start-1 lg:row-start-1">
          {awaiting !== null ? (
            <AwaitingPanel
              reference={awaiting.reference}
              token={awaiting.token}
              exhausted={awaiting.exhausted}
              checking={awaiting.checking}
              onCheckAgain={() => void checkAgainNow()}
            />
          ) : (
            <form noValidate method="post" onSubmit={onSubmit} aria-label="Checkout" className="max-w-[620px]">
              <FormSection title="Contact">
                <Field
                  field="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={form.email}
                  onChange={onDetail("email")}
                  readOnly={locked}
                  error={errors.email}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    field="name"
                    label="Full name"
                    autoComplete="name"
                    value={form.name}
                    onChange={onDetail("name")}
                    readOnly={locked}
                    error={errors.name}
                  />
                  <Field
                    field="phone"
                    label="Phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={onDetail("phone")}
                    readOnly={locked}
                    error={errors.phone}
                  />
                </div>
              </FormSection>

              <FormSection title="Delivery address">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    field="company"
                    label="Company (optional)"
                    autoComplete="organization"
                    value={form.company}
                    onChange={onDetail("company")}
                    readOnly={locked}
                    error={errors.company}
                  />
                  <Field
                    field="vat_number"
                    label="VAT number (optional)"
                    autoComplete="off"
                    value={form.vat_number}
                    onChange={onDetail("vat_number")}
                    readOnly={locked}
                    error={errors.vat_number}
                  />
                </div>
                <Field
                  field="line1"
                  label="Address line 1"
                  autoComplete="address-line1"
                  value={form.line1}
                  onChange={onDetail("line1")}
                  readOnly={locked}
                  error={errors.line1}
                />
                <Field
                  field="line2"
                  label="Address line 2 (optional)"
                  autoComplete="address-line2"
                  value={form.line2}
                  onChange={onDetail("line2")}
                  readOnly={locked}
                  error={errors.line2}
                />
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <Field
                    field="city"
                    label="Town or city"
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={onDetail("city")}
                    readOnly={locked}
                    error={errors.city}
                  />
                  <Field
                    field="postcode"
                    label="Postcode"
                    autoComplete="postal-code"
                    autoCapitalize="characters"
                    value={form.postcode}
                    onChange={onDetail("postcode")}
                    readOnly={locked}
                    error={errors.postcode}
                  />
                </div>
                <div>
                  <label htmlFor={inputId("country")} className="mb-1.5 block text-footnote text-ink-2">
                    Country
                  </label>
                  <input
                    id={inputId("country")}
                    readOnly
                    tabIndex={-1}
                    value="United Kingdom"
                    className="h-11 w-full rounded-[12px] border border-line bg-surface px-3.5 text-body text-ink-2 outline-none"
                  />
                </div>
              </FormSection>

              <FormSection title="Payment">
                <Field
                  field="number"
                  label="Card number"
                  autoComplete="cc-number"
                  inputMode="numeric"
                  placeholder="1234 1234 1234 1234"
                  value={card.number}
                  onChange={onCard("number")}
                  error={errors.number}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    field="expiry"
                    label="Expiry date"
                    autoComplete="cc-exp"
                    inputMode="numeric"
                    placeholder="MM / YY"
                    value={card.expiry}
                    onChange={onCard("expiry")}
                    error={errors.expiry}
                  />
                  <Field
                    field="securityCode"
                    label="Security code"
                    autoComplete="cc-csc"
                    inputMode="numeric"
                    placeholder="123"
                    value={card.securityCode}
                    onChange={onCard("securityCode")}
                    error={errors.securityCode}
                  />
                </div>
              </FormSection>

              <div className="mt-10 space-y-4">
                {declined ? (
                  <div
                    ref={declinedRef}
                    tabIndex={-1}
                    data-testid="declined-panel"
                    role="alert"
                    className="rounded-[14px] border border-danger/20 bg-danger/[0.04] p-4 outline-none"
                  >
                    <p className="text-callout font-medium text-danger">
                      Your card was declined. You haven&apos;t been charged.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" variant="ink" size="sm" onClick={() => void pay()} disabled={blocker !== null}>
                        Try again
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={switchCard}>
                        Use a different card
                      </Button>
                    </div>
                  </div>
                ) : null}

                {message !== null ? (
                  <div
                    ref={messageRef}
                    tabIndex={-1}
                    data-testid="checkout-message"
                    role="alert"
                    className={cn(
                      "rounded-[14px] p-4 text-callout outline-none",
                      message.tone === "danger"
                        ? "border border-danger/20 bg-danger/[0.04] text-ink"
                        : "border border-low/25 bg-low/[0.07] text-ink",
                    )}
                  >
                    <p>{message.text}</p>
                    {message.detail && locked ? (
                      <p className="mt-1 text-footnote text-ink-2">{message.detail}</p>
                    ) : null}
                    {locked && awaiting === null ? (
                      // No order was named, so there is nothing to view: offer a way out.
                      <div className="mt-3 border-t border-danger/10 pt-3">
                        <p className="text-footnote text-ink-2">
                          If your earlier payment did go through, starting again could order twice.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={startNewOrder}
                          disabled={submitting}
                        >
                          Start a new order
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full"
                  disabled={blocker !== null}
                  aria-busy={submitting || undefined}
                  aria-describedby={blocker === "sold-out" || blocker === "quote-failed" ? "pay-hint" : undefined}
                >
                  {submitting ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      Paying…
                    </>
                  ) : total !== null ? (
                    `Pay ${total}`
                  ) : (
                    "Pay"
                  )}
                </Button>

                {blocker === "sold-out" ? (
                  <p id="pay-hint" className="text-center text-footnote text-ink-2">
                    Remove the sold-out item from your bag to pay.
                  </p>
                ) : null}
                {blocker === "quote-failed" ? (
                  <p id="pay-hint" className="text-center text-footnote text-ink-2">
                    We couldn&apos;t check your bag&apos;s prices.{" "}
                    <button type="button" onClick={retryQuote} className="text-accent hover:underline">
                      Try again
                    </button>
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </CheckoutShell>
  );
}

function CheckoutShell({ children }: { children: ReactNode }) {
  return (
    <div className="shop-container pt-8 pb-20 md:pt-12 md:pb-28">
      <h1 className="headline mb-8 text-title-2 md:mb-10">Checkout</h1>
      {children}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-10 first:mt-0">
      <h2 id={id} className="mb-4 text-body font-semibold text-ink">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

type FieldProps = Omit<ComponentProps<"input">, "id" | "name"> & {
  field: CheckoutField;
  label: string;
  error?: string;
};

/** A labelled input with its error underneath. Inputs have no `name`: nothing here is ever form-submitted. */
function Field({ field, label, error, readOnly, className, ...props }: FieldProps) {
  const id = inputId(field);
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-footnote text-ink-2">
        {label}
      </label>
      <input
        id={id}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-11 w-full min-w-0 rounded-[12px] border border-input bg-white px-3.5 text-body text-ink transition-[border-color,box-shadow] outline-none placeholder:text-muted/60",
          "focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15 focus-visible:outline-none",
          "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15",
          "read-only:border-line read-only:bg-surface read-only:text-ink-2",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} data-testid={`${field}-error`} className="mt-1.5 text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

# F4 Checkout: builder's report

Stream `f-checkout`. The checkout lives at `/checkout`. Built and tested natively on the owner's Mac, because the owner decided to drop Docker after the container's disk failed twice.

## Commits

On the worktree branch `worktree-agent-a0cfdee4940e9e489`, which was fast-forwarded from `sf/f-checkout` at `bc6b9b0`. Nothing is pushed, as the coordinator asked.

- `9be3e39` feat(frontend): one-page checkout with retry-safe payment and stock recovery
- `657a192` test(frontend): two submits in the same instant send one checkout request. This is the last code commit.
- This report is committed last, on top of `657a192`.

The files are all new. No `[frozen]`, `[coordinator]` or `components/ui/` file changed, and no dependency was added.
- `app/checkout/page.tsx`
- `components/checkout/{checkout-form,order-summary,awaiting-panel}.tsx`
- `lib/checkout-{schema,attempt,outcome}.ts`, each with its `.test.ts`
- `e2e/checkout.spec.ts`

## Results

All commands were run from `frontend/`.

| Command | Result |
|---|---|
| `npm test` | `Test Files 7 passed (7)`, `Tests 68 passed (68)` |
| `npm run typecheck` | exit 0 (`api-types.ts` unchanged, `tsc --noEmit` clean) |
| `npm run lint` | exit 0, after `rm -rf playwright-report test-results` as the coordinator instructed (the eslint ignore fix is on `storefront` in `ed10156`) |
| `E2E_DATABASE_URL=postgresql://localhost/commercelab_fco_e2e E2E_API_PORT=8140 E2E_WEB_PORT=3140 npm run e2e -- checkout.spec.ts` | `13 passed (21.6s)`. Nothing skipped, nothing flaky |

**How red was seen:**
- **Unit tests:** red with the three modules missing, which is a correct reason to fail.
- **E2E:** the first run failed at the build step, because `/checkout` and the libraries didn't exist yet.

## Mutation checks

Each mechanism was broken, a test was seen going red, and the code was restored. The restore was checked with `git diff` (only intended changes left) and `grep MUTATION` (nothing found).

| # | Mutation | Unit result | E2E result |
|---|---|---|---|
| 1 | **The same key is reused for the same body.** In `attemptKey`, the stored key is never returned. | `same fingerprint reuses the key`, `survives a reload`, `different fingerprint gets a new key` and `declined gets a new key` go red. | `network failure keeps the form and the key` and `reloading after an unanswered Pay reuses the stored key` go red: the second key differs from the first. |
| 2 | **A declined attempt gets a new key.** In `attemptKey`, the `declined` flag is ignored. | `declined gets a new key` goes red. | `a declined card can be tried again with a new key` goes red (`Expected: not "b262…"`). |
| 3 | **The in-flight guard.** In `pay()`, the `inFlight.current` check is removed. This one is extra. | – | `double clicking Pay sends one request` still passed: React re-renders and disables the button between two real clicks. So I added `two submits in the same instant send one request`, which calls `form.requestSubmit()` twice in one task. It went red: 2 requests were sent. Both carried the same key, so the attempt key is a second line of defence behind the guard. |

The network-failure and reload tests are deliberately the worst case. Playwright's `route.fetch()` lets the backend really create and charge the order, and then `route.abort()` drops the answer before it reaches the browser. The tests then count rows in `orders` and `payments` with `psql`, so a duplicate order would fail the test even if the page looked right.

## How it works

- **The attempt key.** Each request's key comes from `attemptKey(sessionStorage, fingerprint(body))`. The fingerprint is stable JSON with sorted keys, taken over the trimmed request body.
  - The same body reuses the key: a double click, a retry or a reload.
  - A changed body, or a declined attempt, gets a new key.
  - If sessionStorage is blocked, the key is kept in memory instead.
- **Only one request at a time.** A ref is set before the first `await`, and the button is disabled as well.
- **Pay is only pressable for a total the shopper has seen.** `payBlocker` keeps it disabled in these cases:
  - before the bag has been read, or while the bag is empty;
  - while a request is in flight;
  - while `quoteFailed` is true;
  - while `quoting` is true, or the quote doesn't describe exactly the current lines (it compares each line's `requested` quantity);
  - while `hasSoldOut` is true.
- **Card details never leave the browser.**
  - The card inputs have no `name`, and the form is `method="post"` with `noValidate`, so nothing reaches a URL even before hydration.
  - `toCheckoutRequest` copies named contact and address fields only.
  - A unit test checks this, and the happy-path e2e test checks the real request body: no `4242`, no expiry, no card-like keys.
- **No business rules in TypeScript.** Every number on the page is the quote's, passed through `formatGBP`. The order status alone decides whether the outcome is paid, declined or awaiting.
- **The order page belongs to F5.** On `paid`, the page clears the attempt and the bag, then calls `router.replace("/orders/" + token)`. The e2e tests check that URL and then read the order from `GET /orders/{token}`: a `CL-` reference, status `paid`, the right items and the company name. The coordinator confirmed this approach.

## Deviations, each with its reason

1. **The form locks while the outcome is uncertain** (the coordinator's decision). After `retryable` or `awaiting`, the contact and address fields become read-only until the outcome resolves.
   - A second Pay is therefore the same body with the same key.
   - The plan's rule still holds: a changed body gets a new key.
   - The retry message adds "Your details are locked so a retry can't create a second order."
   - The lock lives in memory, so a reload clears it. The reload also empties the fields, and re-entering the same details reuses the stored key, which an e2e test covers.
2. **Pay is also disabled while quoting, or while the quote is for other lines.** The plan only names `quoteFailed`, `hasSoldOut` and in flight. Without this, Pay could briefly show and charge a total the shopper hasn't seen, for example just after a 409 changes the bag.
3. **Server field errors use the page's own plain wording.** For example, the postcode shows "Enter a UK postcode." rather than Pydantic's text. The outcome still carries the server's message in `fields`; only the display differs.
4. **A 422 with a string detail gets plain wording.** For guest checkout this can only be the backend's `ProductUnavailable` ("Products not available: [12]"), which is written for developers. The page shows "An item in your bag is no longer sold. Reload the page to update your bag." instead.
5. **The stock outcome also shows a short message above Pay:** "Your bag has changed. Check the total, then pay again." The warning in the summary is exactly as the plan has it. On mobile the summary sits above the form, so without this message the warning would be off-screen when Pay is pressed.
6. **A sold-out line has a "Remove" link in the summary.** The checkout header has no bag button, so the drawer can't be opened from this page. Pay stays disabled, with the hint "Remove the sold-out item from your bag to pay."
7. **"Try again" after a failed quote calls `open()` and then `close()` in the same handler.** `useCart()` has no re-quote action, and `open()` is the only thing that asks again. Both calls are batched, so the drawer never appears.
8. **Labels and copy:**
   - While a request is in flight, Pay reads "Paying…" with a spinner.
   - Delivery reads "Free" when the quote's delivery is zero; any other amount would be formatted.
   - The summary heading is "Your bag", and the VAT line reads "Includes £x VAT" using the quote's `vat_included`.
   - The empty bag shows "Your bag is empty." with one line of help and a "Continue shopping" pill.
   - After payment, the page shows "Payment received. Opening your order…" for the moment before the redirect.
9. **Extra tests beyond the plan:**
   - Declined, "use a different card" and awaiting. These answer the first request with `page.route` and let the next request reach the real backend. The simulated provider can't decline or time out at 0%.
   - Local validation before sending.
   - Sold-out blocking.
   - Two submits in the same instant.
   - Unit tests for input formatting, corrupt or blocked storage, malformed answers, and `payBlocker`.
10. **Process changes, all on the coordinator's instructions:**
    - **Branch:** commits are on the worktree branch, not pushed. That branch is at the same commit as `sf/f-checkout`, which is checked out in another worktree.
    - **Environment:** native Mac, with database `commercelab_fco_e2e` and ports 8140/3140.

## Contract risks for the coordinator

- **A duplicate order is still possible in one narrow case.** It needs an uncertain failure, then a reload, then *different* details (an email typed in different case counts). The browser then sends a new key, and if the first request did reach the server, a second order is created. Closing this fully would take one of:
  - storing the unresolved request body in sessionStorage and re-sending it before any new attempt; or
  - a backend way to look up a customer's pending order.
- **`useCart()` has no explicit re-quote action.** That is why deviation 7 uses `open()` and `close()`. If F3's drawer ever reacts to `open()` with side effects (focus, animation), a `requote()` in the provider would be cleaner. That would be a coordinator change to a frozen file.
- **The declined and awaiting flows are proven against mocked first responses only**, because of the simulated provider's limits (F0's known limitation). The re-sends after them do go to the real backend.
- **Every string 422 is assumed to be `ProductUnavailable`.** If the backend adds other string-detail 422s on `/checkout`, deviation 4's wording would need revisiting.

## What it looks like

**Desktop (1280 wide):**
- The minimal header from the layout: wordmark and "Secure checkout".
- A "Checkout" title, then two columns.
- **Left (up to 620px):** three quiet sections with a semibold label each and no dividers:
  - Contact: email, then name and phone side by side.
  - Delivery address: company and VAT number side by side, line 1, line 2, town and postcode, and a fixed grey "United Kingdom".
  - Payment: card number, then expiry and security code.
  - Inputs are 44px high with 12px corners and labels above. Below them is a full-width blue pill, `Pay £x`.
- **Right (380px, sticky):** a pale-grey 18px-radius panel, "Your bag":
  - each line with a 64px photo, brand, name, "Qty n" and the line total;
  - then Subtotal, Delivery "Free", a semibold Total and "Includes £x VAT".

**Mobile (390 wide):**
- One column: title, then the bag summary, then the form.
- Name and phone, company and VAT, and town and postcode stack. Expiry and security code stay side by side.
- Pay is full width.

**Each outcome:**
- **Paid:** a brief "Payment received. Opening your order…", then `/orders/{token}`. The bag is emptied and the attempt key forgotten.
- **Declined:** a soft red panel above Pay: "Your card was declined. You haven't been charged." It has "Try again" (a dark pill, which sends a new key) and "Use a different card" (an outline pill, which empties and focuses the card fields). Details and bag are kept and stay editable.
- **Awaiting:**
  - The form is replaced by a bordered panel with a small blue spinner, "We're confirming your payment.", the plan's reassurance copy, an "Order reference CL-…" box and a "View your order" link. There is no Pay button.
  - The page re-sends the same request and key after 2 s, 4 s and 8 s, then offers "Check again now".
  - A paid or declined answer resolves the panel.
- **Stock:** in the summary, the line shows "Qty ~~2~~ 1" with an amber note: "Only 1 H1 Wireless Headset left. Someone bought one while you were checking out. We've changed your bag to 1 — check the total and pay again." For a unit that sold out completely, the struck-through name and "…has just sold out. We've removed it from your bag…" appear instead. The amber message is also above Pay, and the total and `Pay £x` update once the re-quote arrives.
- **Conflict:** "Your bag changed while you were paying. Please press Pay again." The attempt is cleared.
- **Invalid:** "Please check the highlighted fields." above Pay. Red text appears under each field, the field gets `aria-invalid`, and focus moves to the first one.
- **Retryable:** a soft red panel: "Something went wrong. Your order wasn't placed twice — press Pay to try again." It adds the lock line. The key is kept, and contact and address show grey and read-only until the outcome resolves.
- **Empty bag:** a centred "Your bag is empty." with a "Continue shopping" pill.

# F4 Checkout: builder's report

## Third review fix (one commit: "fix(frontend): never pay a locked order without its price")

This closes probe D: an order was locked, its own quote failed after every retry, and Pay was still enabled with an empty summary.

- **Pay is blocked.** `payBlocker` gains `lockedQuoteFailed`, which returns `"quote-failed"`. The form sets it when the order is locked and its quote attempt has finished with no quote (`lockedSummary.quote === null`). Before that answer arrives, Pay was already blocked by `lockedQuoting`, so Pay is now blocked whenever `locked && (lockedSummary === null || lockedSummary.quote === null)`.
- **The same "Try again" hint as the unlocked path appears.** It reads "We couldn't check your bag's prices. Try again". While locked, its button re-runs the locked `fetchQuote`: it clears `lockedQuote` and bumps the effect's `lockedQuoteTry`. "Start a new order" stays available as the way out.
- **Tidying.** The doubled blank lines left by assembling `lib/checkout-outcome.ts` and `lib/checkout-attempt.ts` are gone.
- **New tests:**
  - **Unit:** `payBlocker` returns `"quote-failed"` for a locked order whose quote failed.
  - **E2E:** `a locked order is never paid without its price: Pay waits until its quote arrives`.
    - First the order is locked: the first Pay answer is lost, and the page reloads with `/api/cart/quote` aborted.
    - After the quote's retries, the hint shows, Pay is disabled and reads plain "Pay", the summary has no lines, "Start a new order" is offered, and no second request has been sent.
    - Then the route is restored and "Try again" is pressed: Pay reads `Pay £x`, it is enabled, and it finishes the same order with the same key. Exactly one order and one payment result.
- **Results:**

  | Command | Result |
  |---|---|
  | `npm test` | `Test Files 8 passed (8)`, `Tests 82 passed (82)` |
  | `npm run typecheck` | exit 0 |
  | `rm -rf playwright-report test-results && npm run lint` | exit 0 |
  | e2e on `commercelab_fco_e2e`, ports 8140/3140 | `19 passed (36.6s)`. Nothing skipped. Servers stopped |

- **Mutation 9.** I replaced the new condition with `lockedQuoteFailed: false`. The new e2e test went red: no hint, and Pay was left enabled. I then restored it, and `grep MUTATION` finds nothing.

## Re-review fixes (one commit: "fix(frontend): F4 re-review fixes")

**1. While locked, the summary and Pay describe the request Pay will re-send.**
- **Locked view:**
  - The form asks `/api/cart/quote` to quote exactly `lockedRequest.body.items`, retrying after 1 s, 2 s and 4 s.
  - The summary shows that request under **"Finishing your earlier order"**, with each item at the quantity that was sent.
  - A line's price, and the totals, appear only when that quote prices the request exactly: every item has `quantity === requested === sent quantity`, nothing is missing and nothing was removed. This is `quoteMatchesExactly` in `lib/checkout-outcome.ts`.
  - Otherwise the summary reads "The total is confirmed when this payment goes through." This happens, for example, when the earlier order holds the stock and today's quote cuts the line from 3 to 1.
  - `Pay £x` uses the same exact match, so it shows plain "Pay" otherwise.
  - Pay stays disabled until that quote arrives (`PayState.lockedQuoting`).
  - Today's bag quote is borrowed only as a placeholder, and only when it prices exactly the same items. This stops the summary blinking empty after a failure in the same visit.
- **After `paid`:**
  - The bag is cleared only when it holds exactly the items that were sent.
  - Otherwise the page removes only lines of the products that were ordered, at no more than the ordered quantity. That covers the line cut by the order itself; any other line stays. For example, a new bag made in another tab survives.
  - Handlers read the newest cart through a ref, so a re-check loop started before the bag loaded still sees the current bag.

**2. A bag the quote cuts on load can be paid.**
- `quoteDescribes` now accepts `requested === q || quantity === q`, the same rule F3's drawer uses.
- The provider applies a cut and keeps the quote that made it, so `requested` stays at the old quantity. Under the old rule, Pay was disabled for good.

**3. "Start a new order", the owner's escape hatch.**
- **Where it appears:** only when an attempt is locked and no order was named (retryable, no token). It sits inside the retry message, under the line "If your earlier payment did go through, starting again could order twice."
- **What it does:** it clears the stored attempt, unlocks the form (the details stay, now editable), clears the message and focuses Email. The next Pay builds from today's form and bag and gets a new key.
- It never appears while waiting on a named order; that state has "View your order".

**Tests.**
- **Unit:** `a bag the quote cut on load can still pay`, two `quoteMatchesExactly` tests, and a locked-quote case in the `payBlocker` test.
- **New e2e tests** (each counts `orders` and `payments` rows):
  - `a bag emptied in another tab doesn't change the earlier order Pay finishes` (probe B)
  - `a bag changed in another tab: Pay finishes the earlier order and keeps the new bag` (probe C)
  - `start a new order unlocks the form, and the next Pay uses a new key`
  - `a bag the quote cuts on load can still pay, at the cut total` (50 of LM-ARC-LAMP, cut to 5)
- **Updated e2e test:** the reload-after-failure test now expects the summary to show the request (3), no total, Pay reading plain "Pay", and the cut line gone from the bag after payment.
- **Awaiting test:** it now checks that "Start a new order" is absent.

**E2E stability.** Each test that buys something now takes its own in-stock product, and the scenario products are left out. The suite places about 20 real orders, which used up the spotlight keyboard's seeded stock (seen as "Pay £0.00", sold out, on the 18th test).

**Results:**

| Command | Result |
|---|---|
| `npm test` | `Test Files 8 passed (8)`, `Tests 82 passed (82)` |
| `npm run typecheck` | exit 0 |
| `rm -rf playwright-report test-results && npm run lint` | exit 0 |
| e2e on `commercelab_fco_e2e`, ports 8140/3140 | `18 passed (31.7s)`. Nothing skipped. Playwright stopped its servers (nothing listening on 8140, 3140 or 3141) |

**Mutation checks** (each broken, seen red, restored; `grep MUTATION` finds nothing):

| # | Mutation | Result |
|---|---|---|
| 6 | Show today's bag while locked (`showRequest` false) | The reload-after-failure test and probes B and C went red: no "Finishing your earlier order" summary. |
| 6b | Keep the heading, but price the summary and Pay from today's bag | Probes B and C went red: the summary didn't show the earlier order's line (count 0 instead of 1). |
| 7 | Always wipe the bag on `paid` | Probe C went red: the new bag was wiped. |
| 8 | Revert the `quoteDescribes` rule to `requested === q` | Unit `a bag the quote cut on load can still pay` and e2e `a bag the quote cuts on load…` went red (Pay disabled). |

**One interpretation to flag:** "at most remove those exact lines" became "remove a line of an ordered product only when its quantity is no more than what was ordered". That way the line this very order caused to be cut (3 → 1) leaves with it, while a line of any other product, or a larger quantity of the same product, stays.

## Review fixes (one commit: "fix(frontend): F4 review fixes")

**1. An uncertain attempt now survives a reload or leaving the page (the money issue).**
- `lib/checkout-attempt.ts` has three new functions:
  - `markUncertain(storage, { token?, reference? })`
  - `markSettled(storage)`, which marks a stock or invalid answer: nothing was created, so the key is kept for the same body.
  - `uncertainAttempt(storage)`, which returns `{ key, body, token?, reference? } | null`.
- The body is read back from the stored fingerprint, which is the full request body.
- When each mark is set or cleared:

  | Outcome | What happens to the stored attempt |
  |---|---|
  | `retryable`, `awaiting` | marked uncertain |
  | `paid`, `conflict` | cleared |
  | `declined` | marked declined |
  | `stock`, `invalid` | marked settled |
- **On mount** (`checkout-form.tsx`), if an uncertain attempt exists:
  - the page sets `lastSent` and `lockedRequest` to it;
  - it pre-fills and locks contact and address from the stored body;
  - it shows the AwaitingPanel (and resumes the 2/4/8 s re-checks) when a token is known, or the retry message when not.
- **While locked**, `pay()` re-sends `lockedRequest` exactly as it was, never one rebuilt from the form and bag. Only the card fields are checked, because they aren't stored.
- `payBlocker` gains `locked`: while locked only an in-flight request blocks Pay, because the reload's re-quote may have cut the bag. Pay shows `Pay £x` only when the quote describes the locked items, and plain "Pay" otherwise.
- If the bag is empty but an attempt is locked, the page still shows the locked attempt rather than the empty state.
- The re-check schedule moved to `lib/checkout-recheck.ts` (`recheckUntilKnown`, `stillUnknown`, `RECHECK_DELAYS_MS`) so it can be tested with fake timers.

**2. Focus no longer drops to `<body>` after an outcome.**
- The awaiting heading has `tabIndex={-1}` and takes focus when the panel appears, which also announces the panel.
- After `retryable`, `stock`, `conflict` or a field-less `invalid`, focus moves to the message, which has `tabIndex={-1}` and `role="alert"`.
- After `declined`, focus moves to the declined panel.

**3. The comment in `checkout-attempt.ts` now says it plainly.** The stored fingerprint is the full request body (contact, delivery address, bag lines), never card data, and is scoped to the tab through sessionStorage.

**4. Contrast.** The struck-through old quantity is now `text-muted`, without the `/80` opacity.

**5. New tests.**
- **Unit:**
  - `recheck: rechecks exhausted → Check again now` (fake timers: re-sends at 2 s, 6 s and 14 s, then nothing more)
  - `awaiting → declined on recheck`
  - a network failure while waiting keeps waiting
  - stopping when the run is no longer active
  - five uncertain-attempt tests
  - the `payBlocker` locked rule
- **E2E:**
  - `reload after a network failure restores the locked details and re-sends the same key`. This replaces the earlier reload test. The bag is 3 of a 4-unit product, so the reload's re-quote cuts it to 1, which is the coordinator's scenario.
  - `reload during an unconfirmed payment keeps checking the same key`. The real order is placed, and the page is told it is pending.
  - The awaiting test now counts `orders` and `payments` rows.
  - Focus assertions on the retry message, the declined panel and the awaiting heading.

**Results after the fix:**

| Command | Result |
|---|---|
| `npm test` | `Test Files 8 passed (8)`, `Tests 79 passed (79)` |
| `npm run typecheck` | exit 0 |
| `rm -rf playwright-report test-results && npm run lint` | exit 0 |
| e2e on `commercelab_fco_e2e`, ports 8140/3140 | `14 passed (24.5s)`. Nothing skipped. Playwright stopped its servers afterwards (nothing listening on 8140, 3140 or 3141) |

**New mutation checks** (each broken, seen red, restored; `grep MUTATION` finds nothing):

| # | Mutation | Result |
|---|---|---|
| 4 | While locked, `pay()` rebuilds the body from the form and bag instead of re-sending `lockedRequest`. This is the one the review asked for. | `reload after a network failure…` went red. The page landed on a **second order** with quantity 1 instead of the original 3: a new body, a new key, a second charge. |
| 5 | No restore on mount: `uncertainAttempt` is ignored. | Both reload tests went red: no locked retry message, and no awaiting panel after the reload. |

**Remaining risk.** Shrunk, but not gone:
- Storage is per tab, so an uncertain attempt in one tab is not seen by another tab.
- If sessionStorage is blocked, the lock lives only in memory, so a reload loses it.

The earlier case (a reload, then different details) is now closed, because after a reload the details are locked to the stored request.

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

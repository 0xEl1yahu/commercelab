# F5 report: confirmation, error and content pages (stream f-pages)

Branch `f5-pages-work` (based on `sf/f-pages`, which is checked out in another worktree). Feature commit `3179a22`; the final commit is this report (see `git log -1`). Not pushed, as instructed.

## Results (own database `commercelab_fpages_e2e`, ports 8150/3150/3151)
- `npm test`: 4 files, 28 tests passed.
- `npm run typecheck`: passed (api types unchanged).
- `npm run lint`: passed (after `rm -rf playwright-report test-results`).
- `npm run e2e -- confirmation-and-pages.spec.ts`: 9 passed.
- `npm run e2e -- --project=backend-down`: 3 passed.
- `npm run e2e` (everything, both projects): 22 passed, 0 skipped.

## Deviations
1. **Home test in backend-down.** The plan's "home shows the friendly error page" cannot pass here: `app/page.tsx` is F0's placeholder and makes no API call (F1 replaces it). The test uses `/orders/<token>` instead, which reads the backend. After F1 merges, add the same checks for `/`.
2. **Branch.** `sf/f-pages` is held by another worktree, so I worked on `f5-pages-work` created from it.
3. **Not watched red.** I wrote the e2e tests first but did not run them red before implementing (a run needs a full build). They failed on first green attempts for copy reasons, which confirms they bite.
4. **Shared resources used by mistake.** Before the coordinator's message, two e2e runs used the default `commercelab_e2e` database and ports 8100/3100/3101. Those runs reset that database. All later runs use the stream's own database and ports. Servers are stopped.
5. **Pending/cancelled coverage.** The checkout flow can't produce those statuses on demand, so the tests set `orders.status` with `psql` against the e2e database (setup only).
6. The 404 page asks `GET /categories` and falls back to a fixed list of the six categories if the backend can't be reached, so it never needs the backend to render.

## Contract risks
- `OrderOut.status` has four values; `paid` and `fulfilled` render the same, `cancelled` and `pending` as briefed. Unknown future statuses would show the pending view.
- The pending copy says the page shows the result on refresh. The page does not poll.
- Photo credits: the privacy page says credits are kept with each image (true in the schema: `licence`, `credit` columns), but the public API does not expose them, so no page shows them.

## What it looks like
- **Confirmation, paid or fulfilled:** a centred 560px column on white. A green circular tick, a semibold headline "Thank you, Sam. Your order is placed.", a muted line about keeping the link. A grey 18px panel with the order reference. Item lines (`name × qty`, price) between hairlines. Delivery Free, "Total paid" bold, "Includes VAT" small and muted. A grey "Delivering to" panel with the address. A blue "Continue shopping" pill. At 375px it is the same column with 16px gutters and no sideways scroll.
- **Pending:** headline "We're confirming your payment.", a reassurance not to pay again, the reference panel, no buttons.
- **Cancelled:** headline "This order was cancelled. You weren't charged.", the reference, a "Back to the shop" pill.
- **404:** centred headline "We couldn't find that page.", a Home pill and the six categories as grey pills that wrap on mobile. Status 404.
- **Error:** centred headline "We can't load the shop right now.", a short line saying the bag is safe, and a "Try again" pill that calls `reset()`.
- **Content pages (Delivery & returns, Contact, Terms, Privacy):** a 680px reading column, headline title, one muted intro line, then titled sections in 17px grey-ink text. Same layout at mobile width, with no horizontal scroll (tested at 375px).

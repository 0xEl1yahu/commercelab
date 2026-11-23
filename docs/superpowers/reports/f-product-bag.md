# Report: F3 product page and bag drawer (`sf/f-product-bag`)

Built on the local branch `f-product-bag-work` (tracking `origin/sf/f-product-bag`, cut from `bc6b9b0`), because `sf/f-product-bag` is checked out in another worktree. Nothing was pushed.

**Commits:** implementation `2aecd1d`; this report is the commit on top of it (`git log -1` on the branch).

## Results

Run natively on the Mac (the owner dropped Docker), from `frontend/`, with `E2E_DATABASE_URL=postgresql://localhost/commercelab_fprod_e2e E2E_API_PORT=8130 E2E_WEB_PORT=3130`.

| Command | Result |
|---|---|
| `npm test` | 5 files, 32 tests passed (4 new in `buy-limit.test.ts`) |
| `npm run typecheck` | passes (generated `api-types.ts` unchanged, `tsc --noEmit` clean) |
| `npm run lint` | clean |
| `npm run e2e -- product-and-bag.spec.ts` | 23 passed, 0 skipped, 0 failed |
| `npm run e2e` (whole suite, with `shell.spec.ts`) | 33 passed, 0 skipped |

Mutation check: dropping `!stale && !hasSoldOut` from the drawer's Check out condition made two tests fail ("check out waits for the quote…", "sold-out line blocks check out"). Restored afterwards.

No `[frozen]` or `[coordinator]` file was changed. `components/ui/` is untouched; the Sheet is sized with className overrides. No new dependencies.

## What was built

- `app/p/[slug]/page.tsx` (server): breadcrumb, gallery, buy box, "About this", "Specifications" (a real `<table>` with row headers), `generateMetadata` (`${brand} ${name} — CommerceLab`). `notFoundOn404` for unknown slugs; one fetch shared by page and metadata via `cache()`.
- `components/product/gallery.tsx`, `buy-box.tsx`, `buy-limit.ts` (+ test).
- `components/cart/quantity-stepper.tsx`: shared pill stepper for the buy box and the drawer.
- `components/cart/bag-drawer.tsx`: the stub, implemented.
- `e2e/product-and-bag.spec.ts`: 23 tests, written first and seen failing before the implementation.

### Product page

- **Desktop (lg and up):** a two-column page. The left column holds the large photo in an 18px panel with thumbnails below it, then "About this" and "Specifications" (reading width about 680px). The right column is a 360px buy box that is `sticky top-[calc(var(--header-height)+16px)]` and spans both left rows, so it stays beside the details while scrolling. Buy box: brand, 32px semibold name, price, "Includes £x VAT", stock badge, a full-width quantity pill, a full-width accent "Add to bag" pill, and the three promise lines separated by hairlines (worded as in the footer). Sold out: no stepper, a disabled "Out of stock" button.
- **Mobile:** one column in the order photo, thumbnails, buy box, About, Specs. The buy box is not pinned (it only sticks from lg, where it has room beside content). Thumbnails scroll sideways if there are many. No horizontal page scroll (tested at 375px).

### Bag drawer

- Right Sheet, 380px on desktop (`sm:max-w-[380px]`) and full width on mobile. It slides the whole width in and out (override of the Sheet's 40px slide). Closes with Escape, the X, Continue shopping, Check out, any link inside it and any route change.
- Header: "Your bag" and, once the quote has the line, `Added {brand} {name}` in the ok colour with a check.
- One row per quote line: thumbnail, name (link), brand, `line_total`, `StockBadge`, a −/+ stepper (+ disabled at 100), "Remove". Notices under the line: the clamp notice, or "Out of stock — remove it to check out." (sold-out lines show no stepper or total).
- Footer: Subtotal, Delivery ("Free" when `"0.00"`), a Total row only when delivery is not free, "Includes £x VAT", a "Check out" pill linking to `/checkout`, and "Continue shopping". Empty bag: "Your bag is empty." with a Continue shopping link to `/`.
- **Stale handling.** Totals dim to 50% and carry `aria-busy` while `quoting`, `quoteFailed`, before `ready`, or when the quote does not describe the lines on screen. Check out is a disabled button in all those states and while any quoted line is sold out. Lines the quote has not described yet show a pulsing placeholder row. When all retries fail, a banner says "We couldn't update your bag." with "Try again" (calls `open()`, which re-asks).

## Deviations

1. **Branch name.** Local branch `f-product-bag-work`, not `sf/f-product-bag` (checked out elsewhere). The coordinator knows.
2. **Oversized-cart test (approved).** The plan says the spotlight product × 9999 gives a stepper at 100. The seed holds only 9 of the spotlight product, so the quote clamps to 9. The test finds a product the quote allows 100 of (asking for 100 of each product at setup) and uses that.
3. **Unknown-slug test (approved).** Asserts HTTP 404 and no buy box, not the 404 page's text, because F5 owns `not-found.tsx`.
4. **Extra files:** `quantity-stepper.tsx` and `buy-limit.ts` (+ test) are not in the task's file list. `buy-limit.ts` holds `purchaseLimit(stock_left)` = `min(10, stock_left ?? 10)`, kept as a pure function so it has a unit test.
5. **Extra tests** beyond the plan's ten: limited-stock stepper bounds, a failed photo falling back to the surface tile, the sticky offset, mobile overflow, quantity chosen before adding, Escape and Continue shopping, steppers and Remove, the notice being cleared on reopen, check out waiting for the quote, the quote-failed banner, drawer widths, 80 lines cut to 50, and a wrong-shape saved bag.
6. **The clamp notice uses the ink-2 text colour with a low-stock coloured dot**, not the low-stock orange text, because the orange (#d9822b) is below AA contrast at 13px.
7. **The promise lines use the footer's wording** ("On every order, with no minimum spend." etc.) so the page does not say two different things.
8. **Setup differences.** `npm ci` ran with `--cache <scratch dir>` because the default npm cache sits on the external drive, which was erroring. Images came from the main checkout's `.cache/images`, copied into the worktree (git-ignored).

## Contract risks

- **Seed stock vs. plan wording** (deviation 2): other streams' tests that assume the spotlight product can reach quantity 100 will fail the same way.
- **`npm run lint` lints `playwright-report/`** (its minified trace viewer fails with 133 errors), because `eslint.config.mjs` (frozen) does not ignore it. After any e2e run the gate must delete `playwright-report/` and `test-results/` first, or lint in a fresh checkout. Suggest adding both to the config's `globalIgnores`.
- **Provider contract:** `add()` followed by `open()` re-quotes once. When `add()` changes nothing (a line already at 100, or a 51st line), `lastAdded` is not set and the drawer shows no "Added" line. This is as designed in `cart-provider.tsx`.
- The drawer stays mounted in the layout, so it relies on its own `usePathname` effect to close on navigation.
- `next/image` reports `src` as an absolute URL in the DOM; tests match `/media/<key>$` with a regex.

## Review fixes (commit "fix(frontend): F3 review accessibility fixes")

- The "Added …" words are `text-ink-2`; only the check icon is green.
- Focus returns to the opener (Add to bag, or the header's Bag button) on Escape, the close button and Continue shopping. Radix only restores focus to a `<Trigger>`, so `onOpenAutoFocus` remembers `document.activeElement` and `onCloseAutoFocus` restores it. A mutation (removing the `focus()` call) fails the new test.
- Touch targets: the drawer's stepper buttons, Remove and Close are 44px on a phone and 32px from `sm` up. The Close button is now the drawer's own (`showCloseButton={false}`), because the Sheet's built-in one is fixed at 32px and `components/ui/` is frozen.
- New e2e tests pin focus restore, the 44px targets, and the `lastAdded` contract (a line already at 100 opens the drawer with no "Added" line).
- Results: `npm test` 32 passed; typecheck passes; lint clean; `npm run e2e -- product-and-bag.spec.ts` 26 passed, 0 skipped.

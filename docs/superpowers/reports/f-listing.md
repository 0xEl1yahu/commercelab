# F2 report: category listing with the filter bar (stream `sf/f-listing`)

Built on branch `f-listing-work` (tracking `origin/sf/f-listing`, base `bc6b9b0`). Not pushed, as instructed.

## Commits

- Feature: `58a14d0` `feat(frontend): category listing with filter bar, sort and paging`
- This report is committed last, on top of it (`git log -1` on the branch).

## Results

| Command | Result |
|---|---|
| `npm test` | 5 test files passed, 43 tests passed (15 are the new `listing-params.test.ts`) |
| `npm run typecheck` | passes (`gen:api`, no diff in `lib/api-types.ts`, `tsc --noEmit`) |
| `npm run lint` | passes, no output (run after `rm -rf playwright-report test-results`) |
| `E2E_DATABASE_URL=postgresql://localhost/commercelab_flist_e2e E2E_API_PORT=8120 E2E_WEB_PORT=3120 npm run e2e -- listing.spec.ts` | 12 passed, 0 skipped, 0 failed |

Test first: `listing-params.test.ts` was run red (module missing) before `lib/listing-params.ts` existed. Mutation check: disabling the min/max swap made `swaps min and max when reversed` fail; restored.

## What was built

- `lib/listing-params.ts` (+ test): `PAGE_SIZE = 8`, `parseListingParams`, `toApiQuery`, `toSearch`, plus `SORTS` and `SORT_LABELS`. `Sort` is derived from the generated OpenAPI types, so a changed enum breaks the build.
- `components/listing/filter-bar.tsx` (client), `components/listing/pager.tsx` (server).
- `app/c/[category]/page.tsx`: 404 for an unknown slug (via `GET /categories`), then `GET /products`; breadcrumb, `h1`, description, "Free delivery on every order.", `FilterBar`, grid, `Pager`. It also sets the page title and description.
- `e2e/listing.spec.ts`: the 7 named tests plus 5 extras (page-1 reset on filter change, price popover, shared URL and Back, no-match state, phone layout).

## Deviations and decisions

1. **Branch and push.** `sf/f-listing` is checked out in another worktree, so I worked on local branch `f-listing-work` from `origin/sf/f-listing`. Per the coordinator's later message: native on the Mac, own database and ports, local commit only, commit trailer `Claude Sonnet 5.5`.
2. **`toSearch` returns `""` or `"?..."`** (the plan did not say). The URL parameter for the stock switch is `in_stock=1` (`true` also accepted); the API gets `in_stock=true`.
3. **Page capped at 10,000** in `parseListingParams`, so `?page=99999999999999999999` cannot become an unsafe offset. This goes beyond the plan.
4. **Price pill and slider.** The slider works in whole pounds, bounded by `floor(facets.min_price)` and `ceil(facets.max_price)`. A thumb at the end of its range means no limit on that side. The slider waits 250 ms after the last change before navigating, so a drag or a run of key presses is one history entry. The price popover is hidden when the category has no price range.
5. **Pills** exist for brands and price only. "In stock only" is shown by the switch itself; "Clear all" resets brand, price and the switch (sort is kept).
6. **A huge well-formed price** (`?min=99999999999999999999999999`) is accepted by the plan's regex. The backend answers 200 with no matches, so the page shows "No products match these filters." with a Clear filters link. My test pins this.
7. **Result count** reads "1 result" in the singular.
8. **Not added:** `loading.tsx` (it would flush headers before `notFound()` and make the unknown-category response a 200). The 404 test asserts status 404, no tiles and no error page, so it still passes once F5 adds `not-found.tsx`.
9. **Grid breakpoints:** 2 columns below 900px, 4 from 900px (not at `md`), so a 768px tablet does not get three columns with two orphans out of eight.

## Contract risks

- Facets are category-wide, not narrowed by the active filters. A brand ticked in the menu can therefore yield 0 results when combined with a price range; the empty state handles it.
- A brand in the URL that does not exist (`?brand=Nobody`) returns 0 results and shows a removable pill. No 422 from the backend.
- The 404 test depends on Next's default or F5's `not-found.tsx` returning status 404; content is not asserted.
- `npm run lint` fails if `playwright-report/` or `test-results/` exist (known; I cleared them before linting).
- The shadcn `Slider` track is `bg-surface`, so the unselected part of the track is faint on the white popover. I did not touch `components/ui/`.

Frozen files: unchanged (only new files under `frontend/app/c/`, `frontend/components/listing/`, `frontend/lib/` and `frontend/e2e/`).

## The page

**Desktop (1280px).** White page. Small muted breadcrumb "Home › Keyboards", a 56px semibold "Keyboards" headline, then the description in ink-2 and "Free delivery on every order." in muted. One filter row: Brand and Price pill dropdowns and the In stock switch on the left; "9 results" and a Sort pill on the right; a hairline below. Active filters appear as small grey removable pills on a second line with "Clear all". Below it, four pale-grey tiles per row with edge-to-edge photos on the white section, eight per page. The pager sits under the grid: "Showing 1–8 of 9" on the left, prev, numbered circles (current one filled ink) and next on the right.

**Mobile (375px).** Headline drops to 40px. The controls wrap: Brand, Price and the switch on the first line, the count on the left and Sort on the right on the second, then pills. The grid is two tiles across, with no sideways scrolling. The pager stacks, centred.

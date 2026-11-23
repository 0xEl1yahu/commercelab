# F1 home page (stream `f-home`): report

**Status: done.** Everything was built and tested natively on the Mac, as the owner
decided: Docker is no longer used.

**Branch:** local `f-home-work`, which tracks `origin/sf/f-home` (based on `bc6b9b0`).
Nothing was pushed. The checkout couldn't switch to `sf/f-home` itself, because another
worktree had it checked out.

**Commits:**
- `cf4713b feat(frontend): home page`
- `7ca8dc8 docs(reports): f-home report` (first version)
- `5409292 fix(frontend): even vertical rhythm between home sections`
- then this report

## Command results

Every command ran from `frontend/`. The Playwright runs used this stream's own database
and ports:
`E2E_DATABASE_URL=postgresql://localhost/commercelab_fhome_e2e E2E_API_PORT=8110 E2E_WEB_PORT=3110`.

| Command | Result |
|---|---|
| `npm test` | `Test Files 4 passed (4)`, `Tests 28 passed (28)` |
| `npm run typecheck` | exit 0 (api-types.ts unchanged, `tsc --noEmit` clean) |
| `rm -rf playwright-report test-results && npm run lint` | exit 0, no findings |
| `npm run e2e -- home.spec.ts` | red first (8 failed), final run `8 passed (8.4s)`, 0 skipped |

## What was built

- **`frontend/app/page.tsx`** is a Server Component.
  - It fetches four things in parallel: `/collections/spotlight`, `/collections/featured`,
    `/collections/quiet-desk` and `/categories`.
  - It then fetches `/products/by-slug/{spotlight.products[0].slug}` for the hero.
  - If the backend is down, `apiGet` throws and the page fails into `error.tsx` (F5).
- **`components/home/hero.tsx`**:
  - a centred eyebrow, "New from Halden"
  - the name as an `h1`: 40px on mobile, 56px (`text-headline`) from md
  - the tagline
  - an accent pill, `Buy · £119.00`, and an underlined "Learn more", both linking to `/p/{slug}`
  - `images[0]` in an 18px panel up to 980px wide, on a white-to-surface gradient
- **`components/home/collection-band.tsx`** is a white section. The title sits on the left
  and the description on the right, stacked on mobile. It has two layouts:
  - `grid` (Featured): 4 up from md, 2 up on mobile
  - `row` (The quiet desk): the first 3 products, 3 up from md, and on mobile a
    scroll-snap row with tiles at 78% width
- **`components/home/category-strip.tsx`** is "Shop by category": six pale-grey tiles, each
  with a title and description, linking to `/c/{slug}`. It is 3 up from md and 2 up on
  mobile, on white.
- **Sections are spaced with top padding only**, and only the last section has bottom
  padding. This keeps the gap between stacked white bands even.
- **No business rules in TypeScript:** prices go through `formatGBP` or the shared
  `ProductTile`/`StockBadge`, and nothing is computed.
- **Nothing else changed:** no frozen files, and no dependencies added.

## Tests (`frontend/e2e/home.spec.ts`)

- `hero shows the spotlight product with tagline and links to it`
- `featured shows 8 tiles each with name, price and stock label`
- `limited product tile in featured says Only 2 left`
- `the quiet desk shows its description and first three products` (extra)
- `category strip links to all six categories`
- `missing image falls back to a surface tile`: every frame falls back and no `<img>` is left
- `no fallback tiles when images load`: it keeps the plan's skip guard for B2, but it ran
  and passed, because the images are present
- `mobile shows two tiles per row and no horizontal scroll` (extra)

## Deviations

Both were accepted by the coordinator:
- **The mobile quiet desk row scrolls sideways.** A 2-column grid would leave a single
  orphan tile.
- **There is an extra "Shop by category" heading.** It makes the strip a labelled region.

## Screenshot review

The screenshots are in `.superpowers/screens/f-home-desktop.png` (1280px) and
`f-home-mobile.png` (375px), in the main checkout. That folder is gitignored. A
throwaway spec took them and was then deleted.

- **Desktop:** it reads as direction A.
  - The hero is a white field fading to pale grey. "New from Halden" in muted grey sits
    above a two-line, 56px semibold name. The tagline sits below, then the blue Buy pill
    beside "Learn more".
  - The white keyboard photo fills a large rounded panel and carries the screen.
  - Below, on white: "Featured" with its one-line description on the right, then 2 rows
    of 4 grey tiles with edge-to-edge photos. "Only 2 left" shows in orange on the H1
    headset.
  - Then "The quiet desk", with 3 larger tiles. Then "Shop by category" as a 3×2 grid of
    quiet text tiles, then the footer.
- **Mobile:** the same order, in a single column. The headline is 40px over two lines,
  and the Buy and Learn more links sit on one line. Featured is a 2-column grid, the
  quiet desk is a swipeable row with the next tile peeking in, and the categories are a
  2×3 grid. There is no horizontal page scroll (tested).
- **Fixed after the first look:** the gap between stacked white bands was about 160px
  (bottom plus top padding), which broke up Featured and The quiet desk. The bands now
  use top padding only, so every section is evenly spaced (commit `5409292`).
- **Left alone:**
  - The hero's grey gradient meets the white Featured section with a soft edge. That is
    intended: tiles must sit on white.
  - Some photos have their own backgrounds (the light bar's amber glow, the monitor arm's
    window), as stock photography does, and the tiles show them edge to edge.

## Review polish ("fix(frontend): F1 review design polish")

These changes answer the coordinator's review. The checks were re-run afterwards, on the
same database and ports:
- `npm test`: 28 passed
- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm run e2e -- home.spec.ts`: 10 passed, 0 skipped

The screenshots were retaken to the same paths.

- **Hero above the fold.**
  - The photo panel is now 16:10, set through a wrapper override, so `ProductImage` is
    untouched. The image is positioned at `50% 70%`, which takes most of the crop from
    the top.
  - Top padding is tighter, and the name sits on one line from md.
  - At 1280×800, the whole keyboard shows above the fold, with only its bottom edge
    under it.
- **No seam:** the gradient now runs white → surface → white, so the hero blends into
  the white Featured band.
- **Mobile headline** uses the `text-title-1` token.
- **Band headers:** in both bands, the description now sits left-aligned under the title
  (`text-pretty`, 52ch).
- **Category tiles:**
  - The description sits directly under the title.
  - A muted "→" nudges right on hover and darkens. It respects reduced motion.
  - The hover colour is now `bg-line/70`, a token.
- **Tests added:**
  - the hero image has a non-empty alt
  - the hero photo is more than 60% visible at 1280×800
  - the quiet desk has only its three product links (no collection link)
  - on mobile, the quiet-desk row actually scrolls (`scrollWidth > clientWidth`)

## Notes for other streams and the coordinator

- **Section landmarks:** sections are `<section aria-labelledby>`, so tests can find them
  with `getByRole("region", { name })`.
- **Image sizes:** the hero uses `ProductImage` with `priority`. The tile `sizes` values
  assume the 1180px `shop-container`.
- **Footer on mobile (frozen, not F1):** in the 375px full-page screenshot, the company
  details line looks clipped at the right edge. The home spec's no-horizontal-scroll
  check passes, so the line probably wraps. It's worth a glance during the
  whole-branch review.

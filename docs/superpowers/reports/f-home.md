# F1 home page (stream `f-home`): report

**Status: implemented and committed, but not verified in `cl-f-home`.** The container's
filesystem failed: every binary returns `Input/output error` and `/tmp` is read-only.
`cl-f-checkout` fails the same way, which points at the Docker VM rather than this stream.
The Mac's data volume is 96% full (9.6 GB free), which may be the cause. Containers may
not be restarted from this stream, so the gates below need re-running once the container
is healthy.

- Feature commit: `cf4713b feat(frontend): home page`. The final commit is this report on
  top of it.
- Branch: local `f-home-work`, which tracks `origin/sf/f-home` (based on `bc6b9b0`). The
  checkout couldn't switch to `sf/f-home` itself, because another worktree
  (`commercelab-worktrees/sf/f-home`) already has it checked out. Nothing was pushed.

## Command results

Before the coordinator moved the stream into Docker, the commands below ran directly on
the Mac (local PostgreSQL 17, Node 22). They used isolated e2e ports and a separate
database so they couldn't collide with other local streams: `E2E_API_PORT=8140`,
`E2E_WEB_PORT=3140`, `E2E_DATABASE_URL=postgresql://localhost/commercelab_home_e2e`.

| Command | Result |
|---|---|
| `npm test` | `Test Files 4 passed (4)`, `Tests 28 passed (28)` |
| `npm run typecheck` | passed (api-types.ts unchanged, `tsc --noEmit` clean) |
| `npm run lint` | passed, no output |
| `npm run e2e -- home.spec.ts` | red first (8 failed), then `8 passed (10.5s)`, 0 skipped |

None of these has run inside `cl-f-home`: `npm ci` there fails with I/O errors.

## What was built

- `frontend/app/page.tsx` (Server Component) fetches four things in parallel:
  `/collections/spotlight`, `/collections/featured`, `/collections/quiet-desk` and
  `/categories`. It then fetches `/products/by-slug/{spotlight.products[0].slug}` for the
  hero. If the backend is down, `apiGet` throws and the page falls through to `error.tsx`
  (F5).
- `components/home/hero.tsx`:
  - a centred eyebrow, "New from Halden"
  - the name as an `h1`: 40px on mobile, 56px (`text-headline`) from md
  - the tagline
  - an accent pill, `Buy · £119.00`, and an underlined "Learn more", both linking to `/p/{slug}`
  - `images[0]` in an 18px panel up to 980px wide, on a white-to-surface gradient
- `components/home/collection-band.tsx`: a white section with the title on the left and
  the description on the right (stacked on mobile). It has two layouts:
  - `grid` (Featured): 4 up from md, 2 up on mobile
  - `row` (The quiet desk): the first 3 products, 3 up from md, and on mobile a
    scroll-snap row with tiles at 78% width
- `components/home/category-strip.tsx`: "Shop by category", with six pale-grey tiles
  (title and description) linking to `/c/{slug}`. It is 3 up from md and 2 up on mobile,
  on white.
- No prices, totals or stock decisions are computed: everything is `formatGBP` or the
  shared `ProductTile`/`StockBadge`. No frozen files were changed and no dependencies
  were added.

## Tests (`frontend/e2e/home.spec.ts`)

These are the five tests the plan lists, plus three extra checks:
- `hero shows the spotlight product with tagline and links to it`
- `featured shows 8 tiles each with name, price and stock label`
- `limited product tile in featured says Only 2 left`
- `the quiet desk shows its description and first three products` (extra)
- `category strip links to all six categories`
- `missing image falls back to a surface tile`: every frame falls back and no `<img>` is left
- `no fallback tiles when images load`: it keeps the plan's skip guard for missing images,
  but did **not** skip, because B2's images are present
- `mobile shows two tiles per row and no horizontal scroll` (extra)

## Deviations

- **The mobile quiet desk row scrolls sideways** instead of a 2-column grid, which would
  leave a single orphan tile. On desktop it is 3 up, as specified.
- **There is an extra "Shop by category" heading** above the category strip, so the
  section is a labelled landmark.
- **The design hasn't been compared against the direction A mockup.** The screenshot run
  was killed (exit 137) before the move to Docker, and the container can't run anything
  now, so there was no visual pass. **This is outstanding.**

## Notes for other streams and the coordinator

- Sections are `<section aria-labelledby>`, so tests can find them with `getByRole("region", { name })`.
- The hero uses `ProductImage` with `priority`. The `sizes` values assume the 1180px `shop-container`.
- Docker: the VM's filesystem is failing for at least `cl-f-home` and `cl-f-checkout`.
  Check disk space on the Mac (96% full) before re-running the streams.

## How it looks

- **Desktop:** a full-width hero, fading from white to pale grey. The brand eyebrow, a
  56px name, the tagline, a blue Buy pill and "Learn more" are centred, with a large
  rounded photo below. Below the hero, on white, come the "Featured" heading and
  description, then 2 rows of 4 grey tiles. Next is "The quiet desk" with 3 large tiles
  in one row, then "Shop by category" as a 3×2 grid of grey text tiles, then the footer.
- **Mobile (375–390px):** the same order. The headline is 40px; the buttons wrap under
  the tagline and the photo runs the column width. Featured is a 2-column grid, the quiet
  desk is a swipeable row with the next tile peeking in, and the categories are a 2×3
  grid. The page has no horizontal scroll (tested).

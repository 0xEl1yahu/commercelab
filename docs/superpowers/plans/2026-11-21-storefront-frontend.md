# Storefront Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CommerceLab storefront: a Next.js app in `frontend/` that looks and behaves like a real Apple-style IT and office-equipment shop, driven entirely by the FastAPI backend.

**Architecture:**
- Server Components fetch catalogue data from FastAPI, server to server.
- The browser only talks to Next.js. Three route handlers proxy the cart quote, checkout and image bytes.
- The cart lives in localStorage, and every number shown comes from `POST /cart/quote`.
- Types are generated from the committed `openapi.json`.

**Tech Stack:** Next.js 16.4.6 (App Router), React 19.3.1, TypeScript 5.9.3 (not 7.x: Next's type-check integration targets the 5.x compiler API), Tailwind CSS 4.3.5, shadcn/ui (CLI 4.23.0), zod 4.6.7, openapi-typescript 7.13.0, Vitest 5.1.1, Playwright 1.65.1, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-21-storefront-design.md`. The screen decisions are in section 7a.

**Execution:** `2026-11-21-storefront-execution.md`.
- F0 (the frontend contracts) runs as a stream in Phase 1, alongside the backend streams, because it only needs B0's `openapi.json`. Its e2e step needs B6's `reset_db`, so it merges last in Phase 1.
- F1–F5 run in parallel in Phase 2.

## Global Constraints

- **No business rules in TypeScript.** The frontend never computes a price, total, VAT, stock band or order state. Money arrives as decimal strings and is only formatted with `formatGBP`. Input bounds are allowed, because they're conveniences that the server enforces again:
  - quantity 1–100 per line
  - at most 50 distinct lines
  - the form patterns
- **The browser never sees the backend URL.** `API_URL` (default `http://127.0.0.1:8000`) is read only in server code, and `lib/api.ts` imports `server-only`.
- **Images:** an image is `{ key, alt }`, and its URL is always `/media/${key}`, which a route handler proxies to `GET /images/{key}`. Use `next/image` with `unoptimized`, because the files are already sized. The frontend stores no image files.
- **No card data leaves the browser.** The card fields are validated locally and never included in any request.
- **Visual direction A, product as hero.**
  - Tokens: ink `#1d1d1f`, ink-2 `#424245`, muted `#6e6e73`, line `#e5e5ea`, surface `#f5f5f7`, accent `#0071e3`, ok `#2f9e5b`, low `#d9822b`, danger `#d70015`.
  - Radii: tile `16px`, panel `18px`, pill `999px`.
  - Type: the system stack `-apple-system, BlinkMacSystemFont, "Inter", sans-serif`, with Inter from `next/font` as the fallback. Headlines are semibold with `-0.03em` tracking.
  - Light theme only.
  - Product photos are stock photography with varied backgrounds, so tiles show them edge to edge (`object-cover`, 4:3) inside the rounded tile.
- **Shop name: "CommerceLab".** Footer company details (invented): "CommerceLab Ltd · Unit 4, 21 Canal Wharf, Leeds LS11 5PS · Registered in England 15482931 · VAT GB 482 1937 55".
- **Copy never promises what the system doesn't do.** No emails and no delivery dates. The fixed promise lines are "Free UK delivery", "30-day returns" and "2-year warranty".
- **Stock labels:** "In stock", `Only ${stock_left} left`, "Out of stock".
- **Listing page size is 8** (`limit=8`), 4 per row on desktop and 2 on mobile. With 9 active products per category, every category has a page 2.
- **Routes:**
  - `/`, `/c/[category]`, `/p/[slug]`, `/checkout`, `/orders/[token]`
  - `/delivery-returns`, `/contact`, `/terms`, `/privacy`
  - `app/not-found.tsx`, `app/error.tsx`
  - The route handlers `app/api/cart/quote/route.ts`, `app/api/checkout/route.ts` and `app/media/[key]/route.ts`
- **Pin exact versions** in `package.json` (no `^`).
- **Commands, from `frontend/`:**
  - `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run e2e` (Playwright), `npm run lint`
  - `npm run gen:api`: `openapi-typescript ../openapi.json -o lib/api-types.ts`
  - `npm run typecheck`: `npm run gen:api && git diff --exit-code lib/api-types.ts && tsc --noEmit`
- **E2E environment:**
  - `E2E_API_PORT` (default 8100), `E2E_WEB_PORT` (default 3100), and `E2E_DATABASE_URL` (default `postgresql://localhost/commercelab_e2e`).
  - The backend-down project uses `E2E_WEB_PORT + 1`.
  - Every stream runs in its own container or cloud VM, so the defaults are right everywhere. The variables exist for running outside a sandbox.

## Review Focus

1. **A corrupt, stale or oversized saved cart.** Invalid JSON, the wrong shape, ids that no longer exist after a reseed, quantity 9999, or 80 lines. The site loads, bad lines are dropped or capped, and the badge count matches the drawer. Test in F0 (unit) and F3 (e2e).
2. **Double-clicking Pay, or reloading mid-checkout.** One order and one charge. A reload with the same bag and details reuses the stored attempt key. Test in F4.
3. **Hand-edited listing URLs.** `?min=200&max=50` is swapped. `?min=Infinity` and `?min=1e3` are ignored. `?page=99` shows an empty state with a link to page 1. `?sort=nonsense` falls back to featured. An unknown category gives a 404. None of these reach the error page. Test in F2.
4. **The backend is down.** Catalogue pages show `error.tsx`. At checkout, a network failure keeps the form and the attempt key, so Pay can be retried safely. Test in F4 and F5.
5. **A product with no image, or an image request that fails.** The surface fallback tile is shown, never a broken-image icon. Test in F1.

---

### Task F0: Frontend contract freeze (stream `sf/f-contracts`, Phase 1)

Everything the parallel streams import. The files are added to `docs/superpowers/plans/frozen-paths.txt` under `[frozen]`, except `components/cart/bag-drawer.tsx`, which goes under a `[stubs]` section owned by F3.

**Files:**
- Create: `frontend/`. The sandbox mounts a `node_modules` volume at `frontend/node_modules`, so `create-next-app` refuses to scaffold in place. Inside the container, scaffold in a temp directory with `npx create-next-app@16.4.6 /tmp/frontend --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --skip-install`, copy everything except `node_modules` and the scaffold's `README.md` into `/work/frontend`, run `npm install` there. Keep the scaffold's `AGENTS.md` as `frontend/AGENTS.md`: it points agents at the Next.js 16 docs bundled in `node_modules`, and the root `AGENTS.md` still applies. Then run `npx shadcn@4.23.0 init` and `npx shadcn@4.23.0 add button input label popover switch slider dropdown-menu sheet checkbox`
- Create: `frontend/app/globals.css`, `frontend/app/layout.tsx`, `frontend/next.config.ts`, `frontend/.env.example` (`API_URL=http://127.0.0.1:8000`)
- Create: `frontend/lib/api.ts`, `frontend/lib/api-types.ts` (generated), `frontend/lib/types.ts`, `frontend/lib/money.ts`, `frontend/lib/cart.ts`
- Create: `frontend/components/shell/site-header.tsx`, `frontend/components/shell/site-footer.tsx`
- Create: `frontend/components/product/product-image.tsx`, `frontend/components/product/stock-badge.tsx`, `frontend/components/product/product-tile.tsx`
- Create: `frontend/components/cart/cart-provider.tsx`, `frontend/components/cart/bag-button.tsx`, `frontend/components/cart/bag-drawer.tsx` (stub)
- Create: `frontend/app/api/cart/quote/route.ts`, `frontend/app/api/checkout/route.ts`, `frontend/app/media/[key]/route.ts`
- Create: `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/e2e/support.ts`, `frontend/e2e/shell.spec.ts`
- Test: `frontend/lib/money.test.ts`, `frontend/lib/cart.test.ts`
- Modify: the root `.gitignore`, adding `frontend/node_modules/`, `frontend/.next/`, `frontend/test-results/` and `frontend/playwright-report/`

**Interfaces (frozen):**
- `lib/api.ts` (server only):
  - `apiGet<T>(path, { query?: Record<string, string | string[] | undefined> }?) -> Promise<T>`, with `cache: "no-store"`. Throws `ApiError` on a non-2xx response.
  - `apiPost(path, body, headers?) -> Promise<Response>`
  - `class ApiError extends Error { status: number }`
  - `notFoundOn404<T>(p: Promise<T>): Promise<T>`
  - `apiFetchRaw(path, init) -> Promise<Response>`, for the media proxy
- `lib/types.ts`, aliases over the generated `components["schemas"]`:
  - `ProductCard = …["ProductCardOut"]`
  - `ProductDetail = …["ProductDetailOut"]`
  - `ProductPage = …["ProductPage"]`
  - `Category = …["CategoryOut"]`
  - `Collection = …["CollectionOut"]`
  - `CollectionDetail = …["CollectionDetailOut"]`
  - `CartQuote = …["CartQuoteOut"]`
  - `CartLineQuote = …["CartLineOut"]`
  - `Order = …["OrderOut"]`
  - `CheckoutRequest = …["CheckoutRequest"]`
  - `InsufficientStock = …["InsufficientStockOut"]`
  - `Image = …["ImageOut"]`
- `lib/money.ts`: `formatGBP(amount: string): string`, using `Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP"})` for display only.
- `lib/cart.ts`, pure functions:
  - `type CartLine = { product_id: number; quantity: number }`. The keys match the API, so there is no mapping layer.
  - `CART_STORAGE_KEY = "commercelab.cart.v1"`, `MAX_QUANTITY = 100`, `MAX_LINES = 50`
  - `parseCart(raw: string | null): CartLine[]`
    - Invalid JSON or the wrong shape gives `[]`.
    - Lines with non-integer or non-positive quantities are dropped.
    - Quantities are capped at `MAX_QUANTITY`, repeated ids are merged, and only the first `MAX_LINES` lines are kept.
  - `addLine(lines, product_id, qty = 1)` appends, or increases an existing line, capped. It is a no-op when adding a 51st new line.
  - `setQuantity(lines, product_id, qty)`: 0 removes the line, and the quantity is capped.
  - `removeLine(lines, product_id)`
  - `applyQuote(lines, quote): { lines: CartLine[]; adjusted: { product_id: number; from: number; to: number }[] }`
    - Drops `quote.removed`.
    - For `limited` lines with a quoted quantity above 0, it sets the quantity and records the change in `adjusted`.
    - Sold-out lines (quoted quantity 0) are left unchanged.
  - `toQuoteRequest(lines): { items: CartLine[] }`
- `CartProvider` and `useCart()` return:
  - `lines` and `quote: CartQuote | null`
  - `count`, the sum of quoted quantities
  - `notices: Record<number, { from: number; to: number }>`, the clamp notices. They persist until the shopper edits that line or closes the drawer.
  - `hasSoldOut`, true when any quoted line has quantity 0
  - `lastAdded: number | null`
  - the actions `add`, `setQuantity`, `remove`, `clear`, `open` and `close`, and the state `isOpen`

  It loads from localStorage after mount and writes on change. It re-quotes through `/api/cart/quote` 250 ms after the last change, applies `applyQuote`, and merges `adjusted` into `notices`.
- `BagButton`: "Bag" plus `count`, and it calls `open()`.
- `BagDrawer`: a stub exporting `function BagDrawer(): JSX.Element | null`, returning `null`. It is mounted in `layout.tsx`, and F3 implements it.
- `ProductImage({ image: Image | null, sizes, priority? })`:
  - A 4:3 frame on `bg-surface` with radius inherited from its parent, holding `next/image` `fill`, `unoptimized`, `object-cover`, `src={"/media/" + image.key}`.
  - When `image` is null, or `onError` fires, it shows the surface tile.
  - It sets `data-testid="product-image"`, plus `data-fallback="true"` on fallback.
- `StockBadge({ status, left })`: a coloured dot and the stock label.
- `ProductTile({ product: ProductCard })`:
  - A link to `/p/${slug}`, with radius 16.
  - Contains the image, the brand (muted 12px), the name (semibold), and a row with `formatGBP(price)` and the `StockBadge`.
  - Out-of-stock tiles dim the image to 45%.
- Route handlers:
  - `POST /api/cart/quote` forwards to `/cart/quote`.
  - `POST /api/checkout` forwards the body and `Idempotency-Key` to `/checkout`.
  - `GET /media/[key]` forwards to `/images/{key}`, passing `If-None-Match` through, and returns the status, body, `Content-Type`, `Cache-Control` and `ETag` unchanged.

  All three return the backend's status and body unchanged. A backend that can't be reached becomes `502 {"detail": "upstream unavailable"}`.
- `SiteHeader` (Server Component):
  - The wordmark "CommerceLab" linking to `/`, and category links from `GET /categories`.
  - `BagButton`.
  - Sticky, with `bg-white/80`, `backdrop-blur` and a hairline bottom border.
  - A `variant="checkout"` prop hides the categories and shows "🔒 Secure checkout".
- `SiteFooter`: links to the four content pages, the three promise lines and the company details.
- `playwright.config.ts`:
  - `workers: 1`.
  - The ports and database come from the E2E environment variables.
  - **Backend webServer:**
    - command `uv run python -m scripts.fetch_images && uv run python -m scripts.reset_db && uv run uvicorn commercelab.main:app --port $E2E_API_PORT`, with `cwd: ".."`
    - env `DATABASE_URL`, `APP_ENV=demo` and `SIMULATED_DECLINE_PERCENT=0`
    - `url: http://127.0.0.1:$E2E_API_PORT/health`
  - **Web webServer:** `npm run build && npm run start -- -p $E2E_WEB_PORT`, with `API_URL` pointing at the backend.
  - **Backend-down webServer:** `npm run start -- -p $((E2E_WEB_PORT+1))` with `API_URL=http://127.0.0.1:9`, using `port`, not `url`, because every page returns 500.
  - **Projects:**
    - `default`, with `testIgnore: /backend-down/`
    - `backend-down`, with `testMatch: /backend-down/` and `baseURL` on the +1 port
- `e2e/support.ts`:
  - `apiUrl(path)` builds the backend URL from the E2E environment variables. Tests may call the backend directly for setup.
  - `resetDatabase()` runs `uv run python -m scripts.reset_db` with `cwd ".."`, `DATABASE_URL` and `APP_ENV=demo`. Each spec calls it in `test.beforeAll`.
  - `seedCart(page, lines: CartLine[])` sets `CART_STORAGE_KEY` with `page.addInitScript` before navigation.
  - `placeOrderViaApi(request, items, key?)` POSTs `/checkout` straight to the backend with fixed contact and address values and returns the `Order`.
  - `catalogueIds(request)` returns `{ spotlight, limited, soldOut }` product ids and slugs, read from `/collections/spotlight` and `/products`, looked up by sku through `catalogue_data`'s constants. Those constants are copied as TS consts in this file: `SPOTLIGHT_SKU = "HD-QUILL-GRY"`, `LIMITED_SKU = "OR-H1-BLK"`, `SOLD_OUT_SKU = "MR-SLIM2-WHT"`.
  - `TEST_CUSTOMER`: Sam Okafor, `sam.okafor@northfold.co.uk`, `07700 900412`, Northfold Studio Ltd, 14 Albion Street, Leeds, `LS1 6HX`, card `4242 4242 4242 4242`, expiry `08 / 30`, security code `123`.
- **Known limitation:** `SimulatedProvider` keeps charged payment keys in memory across database resets. Because payment ids restart, a key can hit an earlier spec's cached outcome. This is harmless at 0% declines. Don't write declined-payment e2e tests against it; the decline path is covered by unit tests in F4.

- [ ] **Step 1: Scaffold the app** as in Files (temp directory, then copy). Pin the versions, with `@playwright/test` at exactly `1.65.1` to match the browsers baked into the sandbox image. Run `npm run gen:api`.
- [ ] **Step 2: Write the failing tests.**
  - `money.test.ts`: "119.00" gives "£119.00", and "0.00" gives "£0.00".
  - `cart.test.ts`:
    - `corrupt JSON gives an empty cart`
    - `wrong shape gives an empty cart`
    - `drops non-positive and non-integer quantities`
    - `caps quantity at 100`
    - `keeps at most 50 lines`
    - `merges repeated ids`
    - `addLine appends at the end`
    - `setQuantity 0 removes`
    - `applyQuote drops removed ids, clamps limited lines and reports adjustments`
    - `applyQuote leaves sold-out lines in place`
  - `shell.spec.ts`:
    - `header lists the six categories in order`: Keyboards, Mice, Monitors, Audio, Desk, Cables & docks
    - `footer shows company details and content links`
    - `media proxy serves an image with immutable caching`: take a key from `/products?limit=1` through `apiUrl`, request `/media/<key>`, and expect 200 with an `image/` content type and `immutable` in `Cache-Control`. Call `test.skip` with the reason "no product images seeded yet (B2 not merged)" when the product has no image.
    - `media proxy passes 404 through`: `/media/` followed by 64 zeros gives 404.
- [ ] **Step 3: Run** `npm test && npm run e2e -- shell.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement the interfaces above.**
- [ ] **Step 5: Run** `npm test && npm run e2e -- shell.spec.ts && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 6: Commit** with the message `feat(frontend): contracts — app shell, API client, types, cart state, shared product UI, proxies`.

---

### Task F1: Home page (stream `sf/f-home`)

**Files:**
- Create: `frontend/app/page.tsx`, `frontend/components/home/hero.tsx`, `frontend/components/home/collection-band.tsx`, `frontend/components/home/category-strip.tsx`
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- **Hero:**
  - Get the slug from `GET /collections/spotlight` (`products[0].slug`), then `GET /products/by-slug/{slug}` for the tagline and images.
  - Centred brand eyebrow, `New from ${brand}`.
  - The name as a headline of about 56px, then the tagline.
  - A pill button `Buy · ${formatGBP(price)}` and an underlined "Learn more", both linking to `/p/${slug}`.
  - The first image, large, in a rounded 18px panel on a white-to-surface gradient.
- **"Featured":** the `featured` collection as a 4-column grid of `ProductTile` on a **white** background. Tiles are pale grey cards with edge-to-edge photos (owner decision), so they need a white section to stand out; never place tiles on a `surface` section.
- **"The quiet desk":** the title and description, then a 3-up row of its first 3 products. There is no collection link (collection pages aren't in v1).
- **Category strip:** 6 tiles with each category's title and description, linking to `/c/[slug]`.

- [ ] **Step 1: Write the failing e2e tests:**
  - `hero shows the spotlight product with tagline and links to it`: "Quiet keys. Three devices. One cable.", "Buy · £119.00".
  - `featured shows 8 tiles each with name, price and stock label`
  - `limited product tile in featured says Only 2 left`
  - `category strip links to all six categories`
  - `missing image falls back to a surface tile`: `page.route("**/media/**", r => r.fulfill({ status: 404 }))`, then expect `[data-fallback="true"]`.
  - `no fallback tiles when images load`: without the route override, expect a count of 0 for `[data-fallback="true"]`. It is skipped, with a reason, while any featured product has `image: null` (B2 not merged). The Phase 3 gate requires it to run, not be skipped.
- [ ] **Step 2: Run** `npm run e2e -- home.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the home page.** Before committing, compare it against the direction A mockup for spacing and type scale.
- [ ] **Step 4: Run** `npm run e2e -- home.spec.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(frontend): home page`.

---

### Task F2: Category listing with the filter bar (stream `sf/f-listing`)

**Files:**
- Create: `frontend/app/c/[category]/page.tsx`, `frontend/lib/listing-params.ts`, `frontend/lib/listing-params.test.ts`
- Create: `frontend/components/listing/filter-bar.tsx` (client), `frontend/components/listing/pager.tsx`
- Test: `frontend/e2e/listing.spec.ts`

**Interfaces:**
- `lib/listing-params.ts`:
  - `type ListingParams = { brands: string[]; min?: string; max?: string; inStock: boolean; sort: "featured" | "name" | "price_asc" | "price_desc"; page: number }`
  - `PAGE_SIZE = 8`
  - `parseListingParams(sp)`
    - `min` and `max` are accepted only when they match `^\d+(\.\d{1,2})?$`, and are swapped when `min > max`.
    - An unknown `sort` becomes `featured`.
    - A non-integer page, or one below 1, becomes 1.
    - `brand` may repeat.
  - `toApiQuery(category, p)` maps to `category`, `brand`, `min_price`, `max_price`, `in_stock`, `sort`, `limit` and `offset`.
  - `toSearch(p)` is the inverse, omitting defaults.
- The page:
  - A 404 when the slug isn't in `GET /categories`.
  - Then `GET /products`.
  - Then, in order:
    - the breadcrumb "Home › {title}"
    - the `h1`, then the description and "Free delivery on every order."
    - `FilterBar`
    - the grid
    - `Pager`
- `FilterBar` (client) pushes `toSearch` URLs:
  - **Brand:** a dropdown of checkboxes from `facets.brands`.
  - **Price:** a popover with a two-thumb `Slider` bounded by the facets, labelled in £, applied on commit.
  - **"In stock only":** a `Switch`.
  - **Active filter pills,** each removable.
  - **Right side:** `${total} results` and a Sort dropdown with Featured, Name, "Price: low to high" and "Price: high to low".
- `Pager`:
  - "Showing {from}–{to} of {total}", and page links with the current page as a filled ink circle.
  - A page beyond the last shows "Nothing on this page." with a link to page 1.

- [ ] **Step 1: Write the failing tests.**
  - `listing-params.test.ts`:
    - `swaps min and max when reversed`
    - `rejects Infinity, 1e3 and negative prices`
    - `unknown sort falls back to featured`
    - `page below 1 becomes 1`
    - `toSearch omits defaults`
    - `round trip keeps repeated brands`
  - `listing.spec.ts`:
    - `keyboards shows 9 results, 8 on page 1 and 1 on page 2`, with "Showing 1–8 of 9" and "Showing 9–9 of 9".
    - `brand filter narrows results and adds a removable pill`
    - `in stock only hides the sold-out keyboard`
    - `sorting by price low to high orders the tiles`
    - `page 99 shows an empty state with a link to page 1`
    - `unknown category shows the 404 page`
    - `reversed and malformed price params still render`: `?min=200&max=50`, then `?min=Infinity`.
- [ ] **Step 2: Run** `npm test -- listing-params && npm run e2e -- listing.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run the same commands, then** `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(frontend): category listing with filter bar, sort and paging`.

---

### Task F3: Product page and bag drawer (stream `sf/f-product-bag`)

**Files:**
- Create: `frontend/app/p/[slug]/page.tsx`, `frontend/components/product/gallery.tsx` (client), `frontend/components/product/buy-box.tsx` (client)
- Modify: `frontend/components/cart/bag-drawer.tsx` (implement the stub)
- Test: `frontend/e2e/product-and-bag.spec.ts`

**Interfaces:**
- **Product page** (`notFoundOn404(apiGet("/products/by-slug/" + slug))`):
  - Breadcrumb: Home › `category_title` (a link to `/c/${category}`) › name.
  - **Left:** `Gallery`, with the large image in an 18px-radius panel and **thumbnails below it** that switch the main image.
  - **Right:** `BuyBox`, `sticky`, with `top` set to the header height + 16px. It contains:
    - the brand, then the name as a ~32px `h1`, then `formatGBP(price)`
    - `Includes ${formatGBP(vat_included)} VAT`
    - a `StockBadge`
    - a quantity stepper from 1 to `min(10, stock_left ?? 10)`
    - "Add to bag", an accent-blue pill that calls `add`, then `open`. When the product is sold out it is disabled and reads "Out of stock".
    - the three promise lines, each with a small grey description
  - **Below:** "About this" with the description, and "Specifications" as a two-column table.
  - `generateMetadata` gives the title `"${brand} ${name} — CommerceLab"`.
- **`BagDrawer`,** a right `Sheet`, 380px wide on desktop and full width on mobile:
  - The title "Your bag".
  - `Added ${brand} ${name}` in ok colour when `lastAdded` is set.
  - One row per quote line: thumbnail, name, a −/+ stepper (+ disabled at 100), "Remove", a `StockBadge` and `line_total`.
  - The notice under a line: `Only ${to} available — we've updated your bag.` when it is in `notices`, or "Out of stock — remove it to check out." when its quoted quantity is 0.
  - The footer: Subtotal, Delivery ("Free" when it is `"0.00"`), "Includes VAT", a "Check out" pill (disabled while `hasSoldOut`) linking to `/checkout`, and "Continue shopping".
  - When the bag is empty: "Your bag is empty." and a link to `/`.

- [ ] **Step 1: Write the failing e2e tests:**
  - `product page shows price, VAT line, stock, breadcrumb and specs`: for the spotlight, `Includes £19.83 VAT` and a breadcrumb link reading "Keyboards".
  - `thumbnails switch the main image`
  - `add to bag opens the drawer with the line and totals`
  - `asking for 3 of the limited headset clamps to 2 and the notice stays`: press + three times, wait for the re-quote, and expect the notice to still be visible after 1 s.
  - `sold-out product cannot be added`
  - `stale cart ids are dropped on load`: use `seedCart` with `[{product_id: 999999, quantity: 1}, {product_id: spotlight.id, quantity: 1}]`. One line, and the badge shows 1.
  - `oversized cart is capped`: `seedCart` with the spotlight × 9999 gives the stepper value 100, and + is disabled.
  - `corrupt localStorage does not break the page`
  - `sold-out line blocks check out`: `seedCart` with the sold-out product.
  - `unknown slug shows the 404 page`
- [ ] **Step 2: Run** `npm run e2e -- product-and-bag.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run the same command, then** `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(frontend): product page and bag drawer`.

---

### Task F4: Checkout (stream `sf/f-checkout`)

**Files:**
- Create: `frontend/app/checkout/page.tsx`, `frontend/components/checkout/checkout-form.tsx` (client), `frontend/components/checkout/order-summary.tsx` (client), `frontend/components/checkout/awaiting-panel.tsx` (client)
- Create: `frontend/lib/checkout-schema.ts`, `frontend/lib/checkout-attempt.ts`, `frontend/lib/checkout-outcome.ts`, plus a `*.test.ts` for each
- Test: `frontend/e2e/checkout.spec.ts`

**Interfaces:**
- **`lib/checkout-schema.ts`** copies the backend patterns exactly. It doesn't use `z.email()`, because its rules differ from the backend's.
  - Every string is `.trim()`ed.
  - `email`: `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`, max 254.
  - `name`: 1–100 characters.
  - `phone`: `/^[0-9 +()-]{7,20}$/`.
  - `postcode`: `/^[A-Za-z0-9 ]{5,8}$/`.
  - `line1` and `city`: 1–100 characters.
  - `line2`, `company` and `vat_number`: optional, up to 100 characters.
  - `cardSchema`:
    - the number is 12–19 digits after removing spaces, and passes a Luhn check
    - the expiry is `MM / YY` and not in the past
    - the security code is 3–4 digits
  - `toCheckoutRequest(form, lines): CheckoutRequest` returns `{ contact: {email, name, phone}, address: {line1, line2?, city, postcode, company?, vat_number?, country: "GB"}, items: lines }`. It omits empty optional fields, and **never includes card fields.**
- **`lib/checkout-attempt.ts`:**
  - `ATTEMPT_STORAGE_KEY = "commercelab.checkout-attempt.v1"`, held in sessionStorage.
  - `fingerprint(body)` is stable JSON with sorted keys.
  - `attemptKey(storage, fp)` returns the stored key when the fingerprint matches and it isn't declined. Otherwise it stores and returns a new `crypto.randomUUID()`.
  - `markDeclined(storage)` and `clearAttempt(storage)`.
- **`lib/checkout-outcome.ts`:**
  - `type Outcome = { kind: "paid"; token } | { kind: "declined" } | { kind: "awaiting"; token; reference } | { kind: "stock"; product_id; available } | { kind: "conflict" } | { kind: "invalid"; message: string; fields: Record<string, string> } | { kind: "retryable" }`
  - `interpretCheckoutResponse(status, body): Outcome`:

    | Response | Outcome |
    |---|---|
    | 200 or 201 with order status `paid` or `fulfilled` | `paid` |
    | 200 or 201 with order status `cancelled` | `declined` |
    | 200 or 201 with order status `pending` | `awaiting` |
    | 409 with `product_id` in the body | `stock` |
    | 409 without it | `conflict` |
    | 422 with `detail` as a string | `invalid`, with that message |
    | 422 with `detail` as a list | `invalid`, with fields mapped from each `loc`'s last two parts to `msg`, and the message "Please check the highlighted fields." |
    | anything else, including 502 and status 0 (network) | `retryable` |
- **The checkout page:**
  - Renders no header: the layout shows the checkout header (`SiteHeader variant="checkout"`) on `/checkout` automatically (F0 review). Treat `quote` as stale while `useCart().quoting` or `quoteFailed` is true, and disable Pay while `quoteFailed`.
  - An empty bag shows "Your bag is empty." and a link back.
  - **Left column:**
    - "Contact": email, then name and phone in a row.
    - "Delivery address": company and VAT number (both optional), line 1, line 2, then town/city, postcode and a fixed "United Kingdom" display.
    - "Payment": card number, expiry, security code.
    - A full-width pill button `Pay ${formatGBP(quote.total)}`, disabled while a request is in flight and while `hasSoldOut`.
  - **Right column:** a surface-coloured `OrderSummary` with the quote lines, Delivery Free, Total and "Includes VAT".
  - **Handling each outcome:**
    - `paid`: `clearAttempt`, then `clear()` the cart, then `router.replace("/orders/" + token)`.
    - `declined`:
      - `markDeclined`.
      - A danger panel above the button: "Your card was declined. You haven't been charged." It has two buttons. "Try again" resubmits, with a new key. "Use a different card" clears and focuses the card fields.
    - `awaiting`:
      - Replace the form with `AwaitingPanel`: a spinner, "We're confirming your payment.", "Your card provider hasn't replied yet. Your items are held for you while we check. Don't pay again: this page updates on its own, and you won't be charged twice.", the reference, and a link "View your order" to `/orders/${token}`.
      - Re-send the same body and key after 2 s, 4 s and 8 s, then show "Check again now".
    - `stock`:
      - `setQuantity(product_id, available)`, then wait for the re-quote.
      - `OrderSummary` shows a warning next to the line:
        - if `available > 0`: `Only ${available} ${name} left. Someone bought one while you were checking out. We've changed your bag to ${available} — check the total and pay again.`, with the old quantity struck through.
        - if `available === 0`: `${name} has just sold out. We've removed it from your bag — check the total and pay again.`
      - The next Pay uses a new key, because the body changed.
    - `conflict`: `clearAttempt`, then "Your bag changed while you were paying. Please press Pay again."
    - `invalid`: the message above the button, and the field errors under their inputs.
    - `retryable`: "Something went wrong. Your order wasn't placed twice — press Pay to try again.", keeping the key.

- [ ] **Step 1: Write the failing unit tests.**
  - `checkout-schema.test.ts`:
    - `toCheckoutRequest never contains card fields`
    - `omits empty optional address fields`
    - `trims the email`
    - `rejects a past expiry`
    - `accepts 4242 4242 4242 4242`
    - `rejects a bad Luhn`
    - `patterns match the backend`: a table of 6 emails, 4 phones and 4 postcodes, with the expected results copied from the backend's Pydantic behaviour.
  - `checkout-attempt.test.ts`:
    - `same fingerprint reuses the key`, which covers a reload
    - `different fingerprint gets a new key`
    - `declined gets a new key`
  - `checkout-outcome.test.ts`: one case for each row of the table.
- [ ] **Step 2: Write the failing e2e tests** in `checkout.spec.ts`, using `TEST_CUSTOMER` and `seedCart`:
  - `happy path lands on the confirmation with a CL- reference`
  - `double clicking Pay sends one request`: count `/api/checkout` requests with `page.on("request")`, expect 1, then the confirmation.
  - `someone else buying the last unit shows the stock warning and corrected total`:
    - `seedCart` the limited headset × 2, and fill the form.
    - `placeOrderViaApi(request, [{product_id: limited, quantity: 1}])`.
    - Press Pay. Expect the warning, quantity 1 and total £149.00.
    - Press Pay again, and it reaches the confirmation.
  - `network failure keeps the form and the key`: abort the first `/api/checkout` request with `page.route`, then let the next one through. One order results.
  - `server validation errors show under the fields`: use `page.route` to fulfil `/api/checkout` with a 422 whose `detail` is a list containing `loc: ["body", "address", "postcode"]`.
  - `empty bag shows the empty state`
- [ ] **Step 3: Run** `npm test && npm run e2e -- checkout.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement the interfaces above.**
- [ ] **Step 5: Run the same commands, then** `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** with the message `feat(frontend): one-page checkout with retry-safe payment and stock recovery`.

---

### Task F5: Confirmation, error and content pages (stream `sf/f-pages`)

**Files:**
- Create: `frontend/app/orders/[token]/page.tsx`, `frontend/app/not-found.tsx`, `frontend/app/error.tsx`
- Create: `frontend/app/(content)/delivery-returns/page.tsx`, `contact/page.tsx`, `terms/page.tsx`, `privacy/page.tsx`, `frontend/components/shell/content-page.tsx`
- Test: `frontend/e2e/confirmation-and-pages.spec.ts`, `frontend/e2e/backend-down.spec.ts`

**Interfaces:**
- **Confirmation** (`notFoundOn404(apiGet("/orders/" + token))`), a centred 560px card:
  - **`paid` or `fulfilled`:** an ok-coloured tick, `Thank you, ${first word of customer_name}. Your order is placed.`, "Payment received. Keep this page's link if you'd like to check your order later.", then:
    - the reference box
    - one line per item (`product_name × quantity`, `line_total`)
    - Delivery Free, "Total paid", "Includes VAT"
    - "Delivering to" with the address, when present
    - a "Continue shopping" pill
  - **`pending`:** "We're confirming your payment." with the reference. No Pay button.
  - **`cancelled`:** "This order was cancelled. You weren't charged." and a link to `/`.
- **`not-found.tsx`:** "We couldn't find that page.", plus links to Home and the six categories.
- **`error.tsx`** (client): "We can't load the shop right now." and "Try again", which calls `reset()`.
- **`ContentPage({ title, children })`:** a `max-w-[680px]` column, with the title in the headline style.
- **Copy for the four content pages,** in the shop's voice and consistent with the system, with no lorem ipsum:
  - **Delivery & returns:** free UK delivery, no promised dates, 30-day returns for unused items in their original packaging, and a 2-year warranty from the brand.
  - **Contact:** the invented address, the company details and `hello@commercelab.example`.
  - **Terms:** a plain-English summary.
  - **Privacy:** what is stored (contact, address and order details); card details never reach CommerceLab; product photography credits are kept with each image.

- [ ] **Step 1: Write the failing e2e tests:**
  - `confirmation shows reference, lines, VAT and address`: inside the test, `const order = await placeOrderViaApi(request, [...])`, then `page.goto("/orders/" + order.token)`.
  - `unknown token shows the 404 page`
  - `every footer link opens a real page with a heading`
  - In `backend-down.spec.ts`: `home shows the friendly error page when the API is unreachable`.
- [ ] **Step 2: Run** `npm run e2e -- confirmation-and-pages.spec.ts && npm run e2e -- --project=backend-down`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run** `npm run e2e && npm test && npm run typecheck && npm run lint`. Expected: everything passes.
- [ ] **Step 5: Commit** with the message `feat(frontend): order confirmation, 404 and error pages, footer content pages`.

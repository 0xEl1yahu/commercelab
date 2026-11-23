# Storefront design: CommerceLab IT & office-equipment store

**Status:** approved by the owner, 21 November 2026. Scoped iteratively: each screen
is designed in detail when it is built, against this document.

## 1. Intent

CommerceLab gets a customer-facing storefront: a computer and IT store selling
office equipment (keyboards, mice, monitors, audio, cables, desk kit). It must
**feel completely real** to a shopper who never sees the code: real product
names, brands, photography, specs, delivery and VAT information. It is not a
demo UI and should not visibly show off the engineering underneath.

The storefront is a **separate Next.js application** that talks to the existing
FastAPI backend. **The backend stays the single source of truth** for products,
stock, customers, orders and payments, so the Phase 3 analytics read one
database and never have to reconcile two systems.

**This is a coding project, not a business,** and the owner's main interest is
the **design**: visual quality, layout, interaction and how real it feels. The
backend changes below exist to give the design real data to work with; where
the two compete for effort, the design wins.

**The shop runs locally only.** It is never deployed publicly and real
customers never reach it. That settles several things that would otherwise
need real-world handling:
- **Card form:** the checkout shows a realistic card form, but its values
  never leave the browser. The API receives no card data (the simulated
  provider takes only an amount).
- **Company details:** footer company details, the address and VAT number are
  invented.
- **Out of scope:** hosting, privacy obligations and scheduled reconciliation.

## 2. Goals, non-goals, anti-goals

**Goals (v1 screens, from the owner's list):**

1. **Home:** featured products and collections.
2. **Category / listing:** category filter, price filter, paging, stock level per product.
3. **Product page:** name, price, stock level, images, description, specs.
4. **Cart:** a slide-out drawer, held in the browser.
5. **Checkout:** place and pay, safe to retry, clear handling of stock errors.
6. **Order confirmation:** what was bought, what was paid, and the order
   reference. Its copy promises nothing the system doesn't do: no "we've
   emailed you" (there is no email) and no dispatch date (fulfilment isn't
   built).
7. **Content pages linked from the footer:** delivery & returns, contact, terms,
   privacy. They're static pages written in the shop's voice, so no footer link
   goes nowhere. *(Builder's call.)*

**Non-goals for v1** (possible later):
- customer accounts, sign-in, order history
- search
- reviews, wishlists, recommendations
- real payments (the simulated provider stays)
- discount codes
- multi-currency
- quotes or invoicing workflows

**Anti-goals** (would make this a failure even if it works):
- **A second commerce system.** No WooCommerce, Medusa or Saleor, and no second
  database of orders, customers or stock.
- **Business rules in TypeScript.** The frontend never decides prices, totals,
  VAT, stock or order state. It displays what the API returns and validates
  input only for the user's convenience.
- **A templated or demo look.** Placeholder names, missing images or "Lorem
  ipsum" on any shipped screen.
- **Leaking internal data.** `unit_cost` and other customers' orders must never
  reach the browser.

## 3. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. A commerce engine** (WooCommerce, Medusa, Saleor) with its ready-made storefront | Fastest path to a polished UI, but the engine owns its own database of orders, stock and customers. WooCommerce is PHP/MySQL on WordPress. Medusa and Saleor replace the domain logic already built and tested. Splits the analytics across two systems. | Rejected |
| **B. Vercel's Next.js Commerce template** with a custom adapter | Its maintained version now supports only Shopify; the multi-provider design is no longer actively maintained. | Rejected |
| **C. Extend the FastAPI backend, and build the Next.js storefront from a component kit** (shadcn/ui plus open-source commerce blocks) | More frontend work than a template, but one source of truth. Keeps the tested checkout, stock and reconciliation logic, and the analytics stay in one place. | **Chosen by the owner** |

Component sources for C: shadcn/ui as the base, with MIT-licensed commerce
blocks (product cards, cart sheet, checkout layouts) adapted rather than copied.
Licences are checked per block before use.

## 4. Architecture

```
Browser ──► Next.js (frontend/, TypeScript)
              ├─ Server Components fetch catalogue data from FastAPI (server to server)
              ├─ Route handlers / server actions proxy checkout calls to FastAPI
              └─ Cart state lives in the browser (localStorage)
                        │
                        ▼
            FastAPI (commercelab/, Python) ──► PostgreSQL (single source of truth)
```

- **The browser only ever talks to Next.js.** Next.js calls FastAPI on the
  server side, so there is no CORS setup and the backend URL never reaches the
  browser.
- **The API contract is typed from FastAPI's OpenAPI schema.** TypeScript types
  are generated with `openapi-typescript`, and regenerated whenever `api/models.py`
  changes.
- **The frontend lives in `frontend/`** in this repo, with its own `package.json`.

## 5. What goes where

### Python (the backend: new and changed)

| Change | Why |
|---|---|
| **Categories table.** `categories` (`slug`, `title`, `description`, `position`), referenced by `products.category`. *(Builder's call.)* | Proper titles such as "Cables & docks", nav order and descriptions live in the database, not in TypeScript |
| **Product content.** New columns on `products`: `slug` (unique), `brand`, `tagline`, `description`, `specs` (JSONB, a list of label/value pairs). | The product page, cards and readable URLs need them |
| **Images stored in PostgreSQL** *(owner)*. An `images` table holds the bytes (`bytea`), keyed by the sha256 of those bytes; a CHECK constraint proves the key matches. It also stores the content type, source URL, licence and credit. `product_images` links products to images, with position and alt text. `GET /images/{sha256}` serves them with immutable caching. | Single source of truth, and the frontend stays dumb: it renders `/media/{key}` and holds no files |
| **Collections.** New `collections` table (`slug`, `title`, `description`, `position`) and a `collection_products` join table (`position` for manual ordering). "Featured" is a collection. | Home page merchandising |
| **Listing API.** Add `min_price`, `max_price`, `brand` (repeatable), `in_stock` (boolean) and `sort` (`featured`, `name`, `price_asc`, `price_desc`) to `GET /products`. Return `total` in `ProductPage`. Add each product's primary image. | The filter bar (brand and price dropdowns, "In stock only" switch, sort), and "Showing 1–8 of 9" paging, at 8 per page |
| **Brand list per category.** Return the brands present in the current category, for the Brand dropdown. | So the dropdown never offers a brand with nothing in it |
| **Price range.** Return `min_price` and `max_price` for the current category. | Bounds for the price filter |
| **New routes.** `GET /products/by-slug/{slug}`, `GET /collections`, `GET /collections/{slug}` | Readable URLs and collection pages |
| **Guest checkout.** `POST /checkout` takes customer details instead of a `customer_id`: email, name, phone, delivery address, and optionally company name and VAT number. The backend finds or creates the customer by email (case-insensitive, as the schema already enforces). | There is no customer-creation endpoint, and a real shop can't ask for an id |
| **Delivery address snapshot.** A new `order_addresses` table, copied onto each order at checkout. | Same principle as prices: an order keeps what was true when it was placed |
| **Order lines keep names.** Add `product_name` and `sku` to `order_items` at checkout. Return them from the order endpoint. | The confirmation screen needs names, and renamed products must not change past orders |
| **Unguessable order links.** Add `orders.public_token` (random, unique). The confirmation page and `GET /orders/{token}` use it instead of the numeric id. | Today anyone can view any order by guessing its id |
| **VAT shown, not stored separately.** Prices stay tax-inclusive. The API returns `vat_included` (20% of a tax-inclusive price is total ÷ 6, with the existing half-up rounding) on orders, in the cart quote, and on the single-product response for the product page's "Includes £x VAT" line. | UK shoppers and office buyers expect the VAT amount. Computing it is a business rule, so it lives in Python. |
| **Delivery cost.** v1: free standard delivery, shown on every screen. (A paid express option is a later decision.) | Keeps the order total equal to the sum of its items, which the invariants already test |
| **Stock shown as bands, not counts.** Add `stock_status` to product responses: `in_stock`, `low_stock` (5 or fewer available, with the number), or `out_of_stock`. The threshold lives in Python. The frontend shows "In stock", "Only 2 left" or "Out of stock" and never the raw count. *(Builder's call: this is how real shops do it, and the banding is a stock rule, so it can't live in TypeScript.)* | "Stock level per product" on every listing and product page |
| **Remove `GET /orders/{id}`** once the token route exists, so the numeric route can't be used to browse orders | Keeps the "no other customers' orders" anti-goal true |
| **Cart quote.** `POST /cart/quote` takes the browser's cart lines and returns current prices, line totals, availability, VAT and total, without reserving anything. | The cart drawer and checkout summary show server-calculated numbers, and catch prices that changed since the item was added |
| **Seed content.** Rewrite `scripts/seed.py`'s catalogue as a real office-IT range: 54 active products (9 per category, at least 2 brands each) plus 1 discontinued. Brands, names, descriptions, specs, collections, and images loaded into the database from a curated stock-photo manifest. Keep it deterministic, and keep the scenario products (the 2-in-stock item, the sold-out item, the discontinued item, the repriced items). | "Feels completely real" starts with the data |

**All of these get pytest coverage, in the existing style:**
- schema constraint tests
- domain tests with the shared invariants
- API contract tests

### TypeScript (the frontend: all new)

| Part | Notes |
|---|---|
| **Next.js app** (App Router, TypeScript, Tailwind, shadcn/ui) | In `frontend/` |
| **Screens** | Home, category listing, product page, cart drawer, checkout, order confirmation, plus a 404 and an error page |
| **Cart state** | Lines `{product_id, quantity}` in localStorage. Every displayed number comes from `POST /cart/quote`. |
| **Checkout** | The form is validated with zod for convenience; the server validates again. It generates one `Idempotency-Key` per checkout attempt and reuses it on retry, so a double click or a network retry returns the same order. It handles 409 (stock) by updating the cart with the available quantities, 201/200 by redirecting to the confirmation, and a `pending` order with an "awaiting confirmation" state. A **declined** payment cancels the order and releases its stock, so the next attempt needs a **new** key. An **unknown** outcome is resumed by re-sending the **same** key (the backend then retries the same provider charge, which can't double-charge): the page retries a few times on its own, then offers "Check again now". |
| **API client** | Generated types plus a thin `fetch` wrapper. No business logic. |
| **Images** | Bytes live in PostgreSQL. The frontend renders `/media/{key}`, a route handler that proxies `GET /images/{key}`. It stores no image files. |
| **Tests** | Playwright end-to-end tests for browse, add to cart, checkout and confirmation, plus the "only 2 left" stock error. Component tests only where logic exists. |

## 6. Decisions already made

- Extend our own backend; no third-party commerce engine (owner).
- A real shop, not a portfolio demo (owner).
- A computer and IT store for office equipment (owner).
- A separate Next.js frontend (owner).
- Prices tax-inclusive, in GBP (existing schema).
- Checkout retry safety, stock rules and reconciliation are already built and
  must not be reimplemented in the frontend.

## 7. Open decisions (for the owner)

1. **Who is checking out?** Office buyers (company name, VAT number, prices
   shown excluding VAT, larger quantities) or individuals kitting out a desk?
   *Builder's default until answered:* card checkout for both; optional company
   name and VAT number fields; prices shown including VAT, with the VAT amount
   on the cart and the order.
2. **Shop name:** *decided by the owner: "CommerceLab" for now* (the mockups
   used "Bureau" as a placeholder). Order references display as `CL-` plus
   the order number. The brand voice follows the mockups: short, plain,
   confident sentences, and nothing that promises what the system doesn't do.
3. **Visual direction:** *decided by the owner: product as hero, like Apple.*
   White and pale-grey surfaces, one product filling the hero, short
   confident headlines in a tight sans-serif, rounded product tiles on a grey
   ground, pill-shaped primary buttons. Photography carries the design.
   (Editorial objects and studio goods were the alternatives shown.)
4. **Where product photography comes from:** *decided by the owner: stock
   photography from the internet,* stored in PostgreSQL. Sources are Unsplash
   and Pexels under their free licences, with the licence and credit recorded
   on every image. Photos are chosen for plain backgrounds and no visible real
   brand logos. Because stock backgrounds vary, tiles show photos edge to edge
   rather than as cut-outs on grey. The owner approves a contact sheet of the
   whole set before it is committed.
5. **Real manufacturers or invented brands:** *decided by the owner: invented
   brands:* Halden, Marlow, Tessel, Kestrel, Aster, Orrin, Corda and Lumi. The
   allocation per category is in the backend plan.

   **Catalogue size:** *confirmed by the owner:* about 50–60
   products, roughly 9 per category, so the filters and paging actually do
   something. This multiplies the content and photography work and
   regenerates the seeded order history.

## 7a. Screen decisions (from mockups)

- **Listing page: filter bar** *(owner)*. One row with Brand and Price dropdowns, an "In stock only" switch,
  active-filter pills that can be removed, and Sort with the result count on
  the right. Products use the full width, four per row on desktop. Paging sits
  below the grid. Filters live in the URL query string, so a filtered page can
  be shared and the back button works. Filtering by product details (e.g.
  keyboard layout) is out of v1, and so are the mockup's sub-category
  shortcut pills, because there is no sub-category data. *(Builder's call.)*
  (Sidebar filters were the alternative shown.)
- **Product page: gallery and buy box** *(owner)*. On the left, a large photo
  with thumbnails below it. On the right, a buy box that stays in
  view while scrolling: brand, name, price, "Includes £x VAT", stock band,
  quantity stepper, Add to bag, then free delivery, 30-day returns and
  warranty lines. Description and the spec table sit below. Works the same
  for every product, so no per-product taglines or feature stats are needed.
  (An Apple-style stacked page was the alternative shown.)
- **Bag drawer** *(shown, no objection)*. Slides in from the right on Add to
  bag with an "Added …" confirmation. Lines with thumbnail, quantity stepper,
  Remove and stock band. Footer: subtotal, free delivery, "Includes VAT",
  Check out, Continue shopping. All numbers come from the cart quote.
- **Checkout: one page, two columns** *(owner)*. A minimal header (logo and
  "Secure checkout", no shop navigation). Left: contact (email, name,
  phone), delivery address (optional company name and VAT number), card
  fields, and a "Pay £x" button. Right: a grey order summary with lines,
  delivery, total and VAT. A stock error (409) appears as a warning in the
  summary next to the line it changed, with the quantity shown struck
  through and corrected, and the shopper pays again with the new total.
  (Steps that fold away were the alternative shown.)
- **After Pay: three outcomes** *(builder's design, shown for reaction)*.
  *Paid:* confirmation page with order reference, lines, total paid, VAT and
  delivery address; it says to keep the page link and promises no email or
  delivery date. *Declined:* stay on checkout with "You haven't been charged",
  bag and address kept, Try again / Use a different card. *Unknown:* "We're
  confirming your payment. Don't pay again", with the order reference, and
  the automatic and manual re-checks described in the Checkout row above.

## 8. Left to the builder

- Component structure, styling system details, loading and empty states.
- The exact spec keys for each category.
- How the cart quote is cached or debounced.
- The route structure for the frontend (e.g. `/c/[category]`, `/p/[slug]`).
- Whether collections get their own listing page in v1 or appear only on Home.

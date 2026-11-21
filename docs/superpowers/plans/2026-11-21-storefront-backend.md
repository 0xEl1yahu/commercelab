# Storefront Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the FastAPI backend so a storefront can show a real catalogue (brands, images, specs, collections, stock bands, filters), quote a cart, take a guest checkout with a delivery address, and show an order by an unguessable link. Product images are stored in PostgreSQL.

**Architecture:**
- Same layers as today: schema in `commercelab/data/db.sql`, rules in `commercelab/domain/`, HTTP in `commercelab/api/`.
- Every business number (VAT, stock band, line totals, quote clamping) is computed in Python and returned ready to display. Image bytes are served by the API too.
- The storefront (`2026-11-21-storefront-frontend.md`) only renders what it is given.

**Tech Stack:** Python 3.14, FastAPI 0.165, pydantic 2.14, psycopg 3.3, PostgreSQL 17, pytest 9.2, uv.

**Spec:** `docs/superpowers/specs/2026-11-21-storefront-design.md`.

**Execution:** `2026-11-21-storefront-execution.md`. Task B0 is the frozen-contract task, and B1–B6 run in parallel after it.

## Global Constraints

- **PostgreSQL is the single source of truth,** including image bytes. No other datastore. The image cache folder (`.cache/images/`) is only a download cache that the seed reads from.
- **Money:** `NUMERIC(12,2)`, GBP, tax-inclusive, `Decimal` in Python, a JSON **string** on the wire.
- **Rounding:** `ROUND_HALF_UP` to the penny, everywhere.
- **VAT:** 20%, included in the price. `vat_included = gross ÷ 6`, rounded half up.
- **Delivery:** free standard delivery, `"0.00"`, on every quote and order.
- **Stock bands:** `in_stock` (6 or more available), `low_stock` (1–5, with the number), `out_of_stock` (0). The threshold is `LOW_STOCK_THRESHOLD = 5`.
- **The public API never returns** `unit_cost`, a product's raw `available` count, an order's numeric `id`, or any order except by its `public_token`.
- **Order reference:** `CL-` plus the order id zero-padded to 5 digits, for example `CL-01501`.
- **Catalogue:** 55 products: **54 active, 9 per category**, plus 1 discontinued. The brands are invented, and every category has at least 2 of them:

  | Category | Brands |
  |---|---|
  | keyboards | Halden, Marlow, Tessel |
  | mice | Kestrel, Marlow |
  | monitors | Aster, Tessel (arms) |
  | audio | Orrin, Marlow |
  | desk | Lumi (lamps, webcams), Halden (mats, wrist rests), Tessel (stands) |
  | cables | Corda, Marlow |
- **Images:**
  - An image is identified by the lowercase hex sha256 of its bytes, and the API serves it at `GET /images/{sha256}`.
  - Allowed content types: `image/jpeg`, `image/png`, `image/webp`.
  - Stock photos only, from Unsplash or Pexels under their free licences. Every image records `source_url`, `licence` and `credit`.
  - Each file is at most 1600px wide and 600 KB.
- **Existing patterns hold:**
  - Domain functions take a `conn`, and each wraps its writes in `with conn.transaction():`.
  - Concurrency is decided inside the SQL statement (`ON CONFLICT`, conditional `UPDATE`).
  - Tests use the rolled-back `conn` fixture, and check `tests/support/invariants.py` after any change to stock or orders.
- **Run** `uv run pytest -q` and `uv run ruff check .`. Both must be clean at the end of every task.

## Review Focus

1. **Email case and concurrency at checkout.** `Sam@Northfold.co.uk` and `sam@northfold.co.uk` are one customer. Two simultaneous first-time checkouts with the same new email both succeed with one customer row, and no 500. Test in B5.
2. **Quoting a stale or huge cart.** A quote with a discontinued id, an unknown id, more than is in stock, or 500 of one item returns 200: bad ids go in `removed`, and the rest is clamped with `limited: true`. Test in B4.
3. **Impossible filters.** `min_price > max_price` gives 422 with a readable detail. An offset past the end gives 200, empty `items` and the true `total`. Test in B3.
4. **A retry that changes the address.** The same Idempotency-Key with a different address is a 409 conflict. Test in B5.
5. **An image that doesn't match its key.** A row whose bytes don't hash to its `sha256` can't be stored (CHECK constraint). An unknown key gives 404, and a repeat request with a matching `If-None-Match` gives 304. Test in B0.

---

### Task B0: Backend contract freeze (Phase 0)

Leaves the suite green, and fixes every name, shape and route the other tasks and the frontend rely on. The files listed in `docs/superpowers/plans/frozen-paths.txt` are read-only afterwards.

**Files:**
- Modify: `commercelab/data/db.sql`, `commercelab/data/db.py`, `commercelab/config.py`, `.env.example`
- Modify: `commercelab/api/models.py`, `commercelab/api/errors.py`, `commercelab/api/dependencies.py`, `commercelab/api/routes/products.py`, `commercelab/api/routes/orders.py`, `commercelab/main.py`
- Create: `commercelab/api/routes/collections.py`, `commercelab/api/routes/cart.py`, `commercelab/api/routes/images.py`
- Create: `commercelab/domain/pricing.py`, `commercelab/domain/images.py`, `commercelab/domain/cart.py`, `commercelab/domain/customers.py`
- Modify: `commercelab/domain/catalogue.py`, `commercelab/domain/orders.py`
- Create: `scripts/catalogue_data.py`, `scripts/image_manifest.py`, `scripts/image_manifest.json` (contains `{}`), `scripts/export_openapi.py`, `openapi.json`
- Modify: `scripts/seed.py` (mechanical), `tests/conftest.py`, `tests/support/fakes.py`, `tests/data/test_schema.py`, `tests/data/test_db.py`, `tests/domain/test_inventory.py`
- Test: `tests/domain/test_pricing.py`, `tests/domain/test_images.py`, `tests/api/test_image_routes.py`, `tests/api/test_openapi_export.py`, `tests/api/test_dependencies.py`
- Create: `docs/superpowers/plans/frozen-paths.txt`
- Create: `dev/sandbox/Dockerfile` and `dev/sandbox/run.sh`, the stream containers described in section 4 of the execution doc. Verify by building the image, starting `cl-storefront` with `--memory 4g`, and running `uv run pytest -q` inside it: green, with the same result as on the Mac. Then `docker inspect cl-storefront --format '{{.HostConfig.Memory}}'` should print `4294967296`.
- Modify: `.gitignore`, adding `.cache/`

**Interfaces (frozen):**

*Schema (`db.sql`).* Update the drop order so the script re-runs cleanly.
- `categories (slug TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0)`
- `products` changes:
  - `category` becomes `REFERENCES categories (slug)`.
  - Add `slug TEXT NOT NULL UNIQUE` (same CHECK pattern), `brand TEXT NOT NULL`, `tagline TEXT NOT NULL DEFAULT ''`, `description TEXT NOT NULL DEFAULT ''`, and `specs JSONB NOT NULL DEFAULT '[]'` with `CONSTRAINT products_specs_is_array CHECK (jsonb_typeof(specs) = 'array')`.
  - Add an index on `(category, brand)`.
- `images (sha256 TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'), content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')), data BYTEA NOT NULL, source_url TEXT, licence TEXT, credit TEXT, CONSTRAINT images_key_matches_bytes CHECK (sha256 = encode(sha256(data), 'hex')))`. PostgreSQL's built-in `sha256()` is used, so no extension is needed.
- `product_images (product_id BIGINT NOT NULL REFERENCES products (id), position INTEGER NOT NULL CHECK (position >= 1), image_sha256 TEXT NOT NULL REFERENCES images (sha256), alt TEXT NOT NULL, PRIMARY KEY (product_id, position))`
- `collections (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL)`
- `collection_products (collection_id BIGINT NOT NULL REFERENCES collections (id), product_id BIGINT NOT NULL REFERENCES products (id), position INTEGER NOT NULL, PRIMARY KEY (collection_id, product_id))`
- `customers.phone TEXT`
- `orders.public_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '')`
- `order_items.product_name TEXT NOT NULL` and `order_items.sku TEXT NOT NULL`
- `order_addresses (order_id BIGINT PRIMARY KEY REFERENCES orders (id), name TEXT NOT NULL, phone TEXT NOT NULL, company TEXT, vat_number TEXT, line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, postcode TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'GB' CHECK (country = 'GB'))`

*Catalogue identity (`scripts/catalogue_data.py`).* Shared by the seed, the image curation and the frontend e2e tests.
- `CATEGORIES: list[tuple[str, str, str]]`: (slug, title, description), in nav order:
  - `keyboards`, "Keyboards", "Low-profile, mechanical and compact."
  - `mice`, "Mice", "Quiet, ergonomic and precise."
  - `monitors`, "Monitors", "Sharp screens and the arms to hold them."
  - `audio`, "Audio", "Headsets, speakers and microphones for calls."
  - `desk`, "Desk", "Lamps, stands, mats and webcams."
  - `cables`, "Cables & docks", "Docks, hubs and the cables between them."
- `PRODUCTS: list[tuple[str, str, str, str, str]]`: (sku, slug, name, brand, category). There are 55 rows: 9 active per category, plus `DISCONTINUED_SKU`, with brands as in Global Constraints.
  - Names follow `"K2 Low Profile Wireless Keyboard"` and never repeat the brand.
  - Slugs are `"<brand>-<name>"`, slugified, for example `halden-k2-low-profile-wireless-keyboard`.
- Scenario constants:

  | Constant | Value | Product |
  |---|---|---|
  | `SPOTLIGHT_SKU` | `"HD-K2-GRY"` | Halden "K2 Low Profile Wireless Keyboard" |
  | `LIMITED_SKU` | `"OR-H1-BLK"` | Orrin "H1 Wireless Headset" |
  | `LOW_STOCK_SKUS` | `("KS-ARC-WHT", "LM-ARC-LAMP")` | — |
  | `SOLD_OUT_SKU` | `"MR-SLIM2-WHT"` | Marlow "Slim 2 Wireless Keyboard" |
  | `DISCONTINUED_SKU` | `"MR-BUD1-BLK"` | Marlow "Bud 1 Wired Headset", audio, inactive. It sits outside the 9-per-category count |
- `COLLECTIONS: list[tuple[str, str, str, list[str]]]`: (slug, title, description, skus in order):
  - `spotlight`: `[SPOTLIGHT_SKU]`
  - `featured`: 8 skus across at least 5 categories, **including `LIMITED_SKU`** and not `SOLD_OUT_SKU`
  - `quiet-desk`: "The quiet desk", "Low-profile keyboards, silent mice and warm-light lamps, chosen for long working days.", 6 skus
- `IMAGE_COUNT = {"spotlight or featured": 3, "other": 1}`: the number of images per product that B2 curates.

*Image manifest (`scripts/image_manifest.py`).*
- `@dataclass(frozen=True) class ManifestImage`: `position: int`, `sha256: str`, `content_type: str`, `download_url: str`, `source_url: str`, `licence: str`, `credit: str`, `alt: str`
- `MANIFEST_PATH = Path("scripts/image_manifest.json")`, a JSON object of `{slug: [ManifestImage as dict, ...]}`
- `CACHE_DIR = Path(".cache/images")`
- `load_manifest() -> dict[str, list[ManifestImage]]`
- `cached_bytes(sha256: str) -> bytes`. Raises `FileNotFoundError` whose message contains `"run: uv run python -m scripts.fetch_images"`.

*Domain.*
- `pricing.py`: `VAT_RATE = Decimal("0.20")`, `STANDARD_DELIVERY = Decimal("0.00")`, and `vat_included(gross: Decimal) -> Decimal`. **Implemented.**
- `images.py`: `ImageNotFound(key)` and `get_image(conn, key: str) -> tuple[str, bytes]`, returning (content_type, data). **Implemented.**
- `catalogue.py`:
  - **Implemented:**
    - `LOW_STOCK_THRESHOLD`, `StockStatus`, `Sort`, and `stock_band(available) -> tuple[StockStatus, int | None]`
    - `Image(TypedDict): key, alt`
    - `ProductCard(TypedDict)`: `id, slug, sku, name, brand, category, price, stock_status, stock_left, image: Image | None`
    - `Spec(TypedDict): label, value`
    - `ProductDetail(ProductCard)`, which adds `category_title, tagline, description, specs, images: list[Image], vat_included`
    - `ProductListing(TypedDict): items, total`
    - `Facets(TypedDict): brands, min_price, max_price`
    - `Category(TypedDict): slug, title, description`
    - `Collection(TypedDict): slug, title, description`
    - `CollectionDetail(Collection)`, which adds `products: list[ProductCard]`
    - `ProductNotFound(ref: int | str)`. The message stays `"No active product with id {ref}"` for an int, and is `"No active product {ref!r}"` for a str.
    - `CollectionNotFound(slug)`
    - `_PRODUCT_QUERY`, extended with `slug`, `brand`, the primary image's key and alt (position 1), and `available`, still without `unit_cost`
    - `_card(row) -> ProductCard`
    - `list_categories(conn) -> list[Category]`: categories with at least one active product, ordered by `position`. The header needs it from day one.
  - **Signature only, body `raise NotImplementedError("b-catalogue")`:**
    - `list_products(conn, *, category=None, brands: Sequence[str] = (), min_price: Decimal | None = None, max_price: Decimal | None = None, in_stock: bool = False, sort: Sort = "featured", limit=DEFAULT_PAGE_SIZE, offset=0) -> ProductListing`
    - `listing_facets(conn, *, category: str | None) -> Facets`
    - `get_product(conn, product_id) -> ProductCard`
    - `get_product_by_slug(conn, slug) -> ProductDetail`
    - `list_collections(conn) -> list[Collection]`
    - `get_collection(conn, slug) -> CollectionDetail`
- `cart.py`:
  - `MAX_LINE_QUANTITY = 100`
  - `QuoteLine(TypedDict): product: ProductCard, requested, quantity, limited, line_total`
  - `Quote(TypedDict): lines, removed: list[int], subtotal, delivery, total, vat_included`
  - `quote(conn, items: Iterable[tuple[int, int]]) -> Quote`, stubbed with `"b-cart"`
- `customers.py`:
  - `@dataclass(frozen=True) Contact(email, name, phone)`
  - `@dataclass(frozen=True) DeliveryAddress(name, phone, line1, city, postcode, line2: str | None = None, company: str | None = None, vat_number: str | None = None, country: str = "GB")`
  - `find_or_create(conn, contact) -> int`, stubbed with `"b-checkout"`
- `orders.py`:
  - `_current_prices` also selects `name` and `sku`, and `place_order` writes them to `order_items`, so existing checkout keeps working.
  - `order_reference(order_id: int) -> str` (implemented)
  - `OrderNotFound(ref: int | str)`
  - Stubbed with `"b-checkout"`: `guest_checkout(conn, provider, *, contact: Contact, address: DeliveryAddress, items, idempotency_key) -> CheckoutResult` and `get_order_by_token(conn, token: str) -> dict`

*API models (`api/models.py`).* The final public contract.
- `ImageOut(key, alt)`
- `ProductCardOut`: the `ProductCard` fields. `price` is a string. `stock_status` is a `Literal`, and `stock_left` is `int | None`.
- `ProductDetailOut`: card plus `category_title, tagline, description, specs: list[SpecOut], images: list[ImageOut], vat_included`.
- `FacetsOut(brands, min_price, max_price)`, with prices that are strings or null.
- `ProductPage(items, total, limit, offset, facets)`
- `CategoryOut`, `CollectionOut`, and `CollectionDetailOut(products: list[ProductCardOut])`
- `CheckoutItem(product_id, quantity: Field(gt=0, le=MAX_LINE_QUANTITY))`
- `QuoteItem(product_id, quantity: Field(gt=0, le=10_000))`, so the quote clamps instead of returning a 422
- `CartQuoteRequest(items: list[QuoteItem] = Field(default_factory=list, max_length=200))`
- `CartLineOut(product: ProductCardOut, requested, quantity, limited, line_total)`
- `CartQuoteOut(lines, removed, subtotal, delivery, total, vat_included)`
- `ContactIn`, with `model_config = ConfigDict(str_strip_whitespace=True)`:
  - `email: Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")`
  - `name: Field(min_length=1, max_length=100)`
  - `phone: Field(pattern=r"^[0-9 +()-]{7,20}$")`
- `AddressIn`, with the same strip config:
  - `line1` and `city`: 1–100 characters each
  - `line2`, `company` and `vat_number`: `str | None`, up to 100 characters, with a validator that turns `""` into `None`
  - `postcode: Field(pattern=r"^[A-Za-z0-9 ]{5,8}$")`
  - `country: Literal["GB"] = "GB"`
- `CheckoutRequest(contact: ContactIn, address: AddressIn, items: list[CheckoutItem] = Field(min_length=1, max_length=50))`
- `OrderItemOut(product_id, sku, product_name, quantity, unit_price, line_total)`
- `AddressOut`: the `order_addresses` fields without `order_id`.
- `OrderOut`, with exactly these fields:
  - `reference`
  - `token`
  - `status: Literal["pending","paid","fulfilled","cancelled"]`
  - `payment_status`
  - `created_at`
  - `customer_name`
  - `items`
  - `subtotal`, `delivery`, `total`, `vat_included`
  - `address: AddressOut | None`

  The domain dict may carry more keys (`id`); Pydantic drops them.
- `InsufficientStockOut`, `ErrorOut` and `Health` are unchanged.

*Routes* (thin, calling the domain functions above):

| Route | Returns |
|---|---|
| `GET /products` | `ProductPage` |
| `GET /products/by-slug/{slug}` | `ProductDetailOut` |
| `GET /products/{product_id}` | `ProductCardOut` |
| `GET /categories` | `list[CategoryOut]` |
| `GET /collections` | `list[CollectionOut]` |
| `GET /collections/{slug}` | `CollectionDetailOut` |
| `POST /cart/quote` | `CartQuoteOut` |
| `POST /checkout` | `OrderOut` |
| `GET /orders/{token}` | `OrderOut` |
| `GET /images/{key}` | the image bytes |

- **`GET /products`** query parameters:
  - `category`
  - `brand: list[str] = Query(default=[])`
  - `min_price` and `max_price`: `Decimal | None`, `ge=0`
  - `in_stock: bool = False`
  - `sort: Sort = "featured"`
  - `limit` and `offset`

  When `min_price > max_price`, the route raises `HTTPException(422, "min_price must not exceed max_price")`. `facets` comes from `listing_facets(category=...)`.
- **The by-slug route is declared before `/products/{product_id}`.**
- **`POST /checkout`** is 201, or 200 for a retry. The `Idempotency-Key` header is required, and it calls `orders.guest_checkout`.
- **`GET /images/{key}`:**
  - `key` matches `^[0-9a-f]{64}$`, and anything else is a 422.
  - The response sets `Cache-Control: public, max-age=31536000, immutable` and `ETag: "<key>"`, and returns 304 when `If-None-Match` matches.
- **`GET /orders/{order_id}` is removed.**
- **Error mappings:** `CollectionNotFound` and `ImageNotFound` → 404, `CustomerNotFound` stays 422.

*Settings and tooling.*
- `Settings.simulated_decline_percent: int = Field(default=5, ge=0, le=100)`
- `dependencies.build_demo_provider() -> payments.SimulatedProvider`, with `_demo_provider = build_demo_provider()`
- `.env.example` gains `SIMULATED_DECLINE_PERCENT=5`.
- `db.create_database_if_missing(url: str) -> None` moves here from `conftest.py`, which now calls it.
- `scripts/export_openapi.py`: `main()` writes `json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"` to `openapi.json`.

*Test support (`tests/support/fakes.py`).*
- `insert_product(conn, sku, name, price, cost, *, category="test", brand="Testco", slug=None, active=True) -> int`. It inserts the category with `ON CONFLICT DO NOTHING`, and the slug defaults to the sku lowercased.
- `make_shop` is rebuilt on top of it, with the same return shape.
- `DELIVERY = DeliveryAddress(name="Ann Lee", phone="07700 900000", line1="1 Test Street", city="Leeds", postcode="LS1 1AA")`
- `insert_image(conn, payload: bytes = b"img", content_type="image/jpeg") -> str` returns the key.
- `make_catalogue(conn) -> dict` returns `{"products": {name: id}, "collections": {"featured": id}}` and contains:
  - Categories `keyboards` and `mice`, and brands Halden, Marlow and Kestrel.
  - These products:

    | Name | Category | Price | Stock | Extras |
    |---|---|---|---|---|
    | `hero` | keyboards, Halden | £119.00 | 20 | tagline "Quiet keys. Three devices. One cable.", 3 images, 4 specs |
    | `low` | mice, Kestrel | £149.00 | 2 | — |
    | `sold_out` | keyboards, Marlow | £64.00 | 0 | — |
    | `inactive` | keyboards | — | — | `active = false` |
    | `budget` | keyboards, Marlow | £45.00 | 150 | — |
    | `mid` | mice, Kestrel | £59.00 | 30 | — |
    | `premium` | keyboards, Halden | £180.00 | 30 | — |
  - Each product's `created_at` is set explicitly, 1 day apart in table order, so `featured` sorting is deterministic.
  - A `featured` collection containing `hero`, `low` and `mid`.

*Seed (mechanical, so the suite stays green):*
- Build products from `catalogue_data.PRODUCTS`, with placeholder prices (`£50.00` price, `£20.00` cost) and no images or collections.
- Write the `categories` rows.
- Copy `product_name` and `sku` onto order items.
- Keep the scenario behaviour that the existing seed tests check (limited 2 in stock, 5 repriced, the discontinued product inactive), using the new constants.
- Add every new table to `ALL_TABLES` and `COLUMNS`, with children truncated before their parents.

*Existing tests broken by the contract change:*
- Mark each one `@pytest.mark.xfail(strict=True, reason="<owning task id>")`; the owning task rewrites it and removes the marker.
- Known set:
  - `tests/domain/test_catalogue.py`: every test using `all_pages`, `["available"]`, the `list_categories` shape, or `raised.value.product_id`. Reason `"B3"`.
  - `tests/api/test_catalogue_routes.py`: page shape, product shape, limited dict, `schemas["ProductOut"]`. Reason `"B3"`.
  - `tests/api/test_order_routes.py`: all tests using `customer_id` payloads. Reason `"B5"`.
- **Delete** `test_get_order` from `test_order_routes.py`, because the numeric route no longer exists.

- [ ] **Step 1: Write the failing tests:**
  - **Schema tests,** in `test_schema.py`'s existing style:
    - `test_product_slug_must_be_url_safe`
    - `test_product_slug_is_unique`
    - `test_product_category_must_exist`
    - `test_specs_must_be_a_json_array`
    - `test_image_key_must_match_its_bytes`: a key of 64 zeros with `b"x"` is a CheckViolation.
    - `test_image_content_type_is_restricted`
    - `test_orders_get_a_unique_public_token_by_default`: 32 hex characters, and two orders differ.
    - `test_order_address_country_is_gb`
    - `test_order_items_require_name_and_sku`
  - `test_pricing.py`: 119.00 → 19.83, 268.00 → 44.67, 417.00 → 69.50, 0.05 → 0.01, 0.00 → 0.00.
  - `test_images.py`: `test_get_image_returns_type_and_bytes` and `test_unknown_image_raises`.
  - `test_image_routes.py`:
    - `test_image_route_serves_bytes_with_immutable_caching`
    - `test_if_none_match_gives_304`
    - `test_unknown_key_is_404`
    - `test_malformed_key_is_422`
  - `test_openapi_export.py`: `test_committed_openapi_is_current`, with the failure message `"openapi.json is stale: run uv run python -m scripts.export_openapi"`.
  - `test_dependencies.py`: `test_demo_provider_uses_configured_decline_percent`. Monkeypatch the setting to 0, and `build_demo_provider().decline_percent == 0`.
  - `test_catalogue.py`:
    - `test_stock_band`, parametrized: 0 → `("out_of_stock", None)`, 1 → `("low_stock", 1)`, 5 → `("low_stock", 5)`, 6 → `("in_stock", None)`
    - `test_categories_in_position_order_with_titles`
- [ ] **Step 2: Run** `uv run pytest -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Make the schema changes.** In `test_schema.py`:
  - Add a `kitchen` category row in the `base` fixture.
  - Add `slug` and `brand` to the parametrized product SQL strings. Give the duplicate-sku case a distinct slug, so `products_sku_key` is still the constraint that fires.
  - Add `product_name` and `sku` to the positional `order_items` inserts.

  Move the other raw product inserts in `tests/` to `insert_product`.
- [ ] **Step 4: Implement the rest of the Interfaces block.** Write `catalogue_data.py`'s 55 identity rows. Update the seed mechanically. Mark or delete the broken tests as listed.
- [ ] **Step 5: Run** `uv run python -m scripts.export_openapi && uv run pytest -q && uv run ruff check .`. Expected: all pass. The `xfail` tests count as expected failures, and nothing fails unexpectedly.
- [ ] **Step 6: Write `frozen-paths.txt`** with two sections:
  - **`[frozen]`:** no stream may change these. Every file in this task except those listed below.
  - **`[signatures]`:** the names this task's Interfaces block declares in `commercelab/domain/catalogue.py`, `cart.py`, `customers.py` and `orders.py`. Streams may change their bodies, but never their names, parameters, return types, TypedDicts, dataclasses or constants. Other functions in these files (for example `place_order` and `checkout` in `orders.py`) belong to the owning stream.

  These stay unlisted and belong to their streams: `scripts/seed.py`, `scripts/image_manifest.json`, and the test files B3 and B5 rewrite.
- [ ] **Step 7: Commit** with the message `feat(contracts): freeze schema, API models, routes and shared fixtures for the storefront`.

---

### Task B1: Seed content (stream `sf/b-seed`)

**Files:**
- Create: `scripts/catalogue_content.py`
- Modify: `scripts/seed.py`, `tests/scripts/test_seed.py`

**Interfaces:**
- Consumes: `catalogue_data` and `image_manifest` from B0.
- Produces:
  - `catalogue_content.CONTENT: dict[str, dict]`, keyed by sku: `{price, unit_cost, tagline, description, specs}` for all 55 skus.
    - Each product has 3–5 specs, with labels taken from the table below.
    - `SPOTLIGHT_SKU`: price `"119.00"`, tagline "Quiet keys. Three devices. One cable."
    - `LIMITED_SKU`: `"149.00"`. `SOLD_OUT_SKU`: `"64.00"`.
    - Prices run from £9 to £499, spread within each category.

    | Category | Spec labels |
    |---|---|
    | keyboards | Layout, Connection, Switches, Battery, Weight |
    | mice | Sensor, Connection, Buttons, Battery, Weight |
    | monitors | Size, Resolution, Panel, Ports, Stand |
    | audio | Type, Connection, Battery, Microphone, Weight |
    | desk | Dimensions, Material, Power, Weight |
    | cables | Length, Ports, Power delivery, Data rate |
  - `seed.generate(seed) -> tuple[list[dict], list[dict], dict]`. Its `data` dict gains these keys:
    - `"categories"`
    - `"collections"`, with planned ids, so it is added to `TABLES_WITH_PLANNED_IDS`
    - `"collection_products"`
    - `"product_images"`: `{product_id, position, image_sha256, alt}`, from the manifest. Products with no manifest entry get no rows.
    - `"images"`: `{sha256, content_type, source_url, licence, credit}`, with no bytes, because `generate` stays pure

    Order rows gain `public_token = f"{rng.getrandbits(128):032x}"`.
  - `seed.write(conn, products, customers, data, *, image_bytes: Callable[[str], bytes] | None = None)`:
    - With `image_bytes=None`, each image gets placeholder bytes `b"placeholder:" + manifest_sha256.encode()`, and its key is recomputed as the sha256 of those bytes. `product_images` points at the recomputed key. Tests use this mode.
    - Otherwise it calls `image_bytes(sha)`, and the key stays the manifest's.
  - `seed.main` passes `image_manifest.cached_bytes`.
  - `LOW_STOCK_SKUS` get opening stock 4 and 5. `SOLD_OUT_SKU` gets no restock movement. Neither is ordered by the simulation, nor is `LIMITED_SKU`.
  - Repricing never picks a scenario sku.

- [ ] **Step 1: Write the failing tests** in `test_seed.py`. Extend `TABLES` with the new tables.
  - `test_54_active_products_9_per_category_plus_one_discontinued`
  - `test_every_category_has_at_least_two_active_brands`
  - `test_every_product_has_content`: a non-empty description, and 3–5 specs with non-empty label and value.
  - `test_limited_product_has_exactly_two_available` (renamed)
  - `test_sold_out_product_has_nothing_on_hand`
  - `test_low_stock_products_have_five_or_fewer`
  - `test_discontinued_product_is_inactive`
  - `test_collections_only_contain_active_products`
  - `test_spotlight_has_exactly_one_product`
  - `test_featured_includes_the_limited_product`
  - `test_order_items_carry_the_product_name_and_sku`
  - `test_brands_are_the_invented_set`
  - `test_product_images_match_the_manifest`: one row per manifest entry, in position order. With the empty manifest, that means zero rows.
  - `test_placeholder_image_keys_match_their_bytes`
- [ ] **Step 2: Run** `uv run pytest tests/scripts/test_seed.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass, the invariants and the same-seed tests included.
- [ ] **Step 5: Commit** with the message `feat(seed): office-IT catalogue content, collections, images and order tokens`.

---

### Task B2: Stock photography (stream `sf/b-images`)

**Files:**
- Modify: `scripts/image_manifest.json`
- Create: `scripts/fetch_images.py`, `tests/scripts/test_image_manifest.py`

**Interfaces:**
- Consumes: `catalogue_data.PRODUCTS`, `COLLECTIONS` and `IMAGE_COUNT`, and `image_manifest`.
- `scripts/fetch_images.py` `main(argv)`:
  - For every manifest entry whose `CACHE_DIR/<sha256>` is missing, it downloads `download_url`, verifies the sha256, and writes the file.
  - A mismatch exits non-zero, naming the slug and position.
  - It prints `"Fetched N, cached M"`.
- The manifest has one entry list per active product (54), with `IMAGE_COUNT` images each.
  - `download_url` requests a sized JPEG, at most 1600px wide. For Unsplash that's `...?w=1600&q=80&fm=jpg`; Pexels offers an equivalent sized URL.
  - `alt` is `"{brand} {name}"`, with `", side view"` or `", in use"` for positions 2 and 3.

- [ ] **Step 1: Write the failing tests** in `test_image_manifest.py`:
  - `test_manifest_covers_every_active_product_with_the_right_count`
  - `test_every_entry_has_licence_credit_and_source`: the licence is `"Unsplash License"` or `"Pexels License"`.
  - `test_keys_are_unique_and_well_formed`
  - `test_cached_files_match_their_keys`: skipped with a clear reason when `.cache/images` is empty.
  - `test_cached_files_are_at_most_600kb`: skipped the same way.
- [ ] **Step 2: Run** `uv run pytest tests/scripts/test_image_manifest.py -q`. Expected: FAIL.
- [ ] **Step 3: Curate the photos.**
  - Find photos with WebSearch and WebFetch on Unsplash and Pexels. Do not use Firecrawl.
  - Look for each product type on a plain or neutral background, with **no visible real brand logos**, consistent in tone, and in landscape orientation.
  - Record the entries in the manifest.
- [ ] **Step 4: Run** `uv run python -m scripts.fetch_images`, which fills the cache and the sha256 values.
- [ ] **Step 5: Get the owner's approval.** Build a contact sheet: one local HTML page with every image, labelled with its slug and position. Show it to the owner and **wait for approval**. Replace any images the owner rejects.
- [ ] **Step 6: Run** `uv run pytest -q`. Expected: all pass, with none of the cache tests skipped.
- [ ] **Step 7: Commit** the manifest and the fetch script, but not the cache, with the message `feat(images): curated stock photography manifest and fetcher`.

---

### Task B3: Catalogue queries (stream `sf/b-catalogue`)

**Files:**
- Modify: `commercelab/domain/catalogue.py` (bodies only), `tests/domain/test_catalogue.py`, `tests/api/test_catalogue_routes.py`

**Interfaces:**
- Implements the B0 stubs.
- **`list_products`:**
  - Raises `ValueError` when `min_price > max_price`.
  - The brand filter is `p.brand = ANY(...)`, applied only when brands are given.
  - `total` comes from `count(*) OVER ()`. When the page is empty, run a separate count, so an offset past the end still reports the true total.
  - Sort orders:
    - `featured`: `(available = 0)`, then `created_at DESC`, then `lower(name) COLLATE "C"`, then `id`.
    - `name`: the existing order.
    - The price sorts: price, then name, then id.
- **`listing_facets`:** active products in the category only, with brands listed alphabetically.
- **`get_product_by_slug`:**
  - Joins `categories` for `category_title`.
  - Images are in position order.
  - `vat_included` comes from `pricing`.
- **`get_collection` and `list_collections`:** active products only, in collection position order.
- Every query goes through `_PRODUCT_QUERY` and `_card`.

- [ ] **Step 1: Rewrite the `xfail(reason="B3")` tests and add new ones,** all against `make_catalogue`:
  - `test_lists_only_active_products`
  - `test_filter_by_brand`, `test_filter_by_two_brands`
  - `test_price_filter_is_inclusive_at_both_ends`
  - `test_in_stock_only_hides_sold_out`
  - `test_featured_puts_sold_out_last_then_newest_first`
  - `test_price_sorts_break_ties_by_name`
  - `test_total_counts_all_matches_not_the_page`
  - `test_offset_past_the_end_is_empty_with_true_total`
  - `test_min_above_max_raises`
  - `test_facets_ignore_other_filters`
  - `test_low_product_shows_low_stock_2`
  - `test_unit_cost_is_never_exposed`, extended to every new query
  - `test_detail_has_category_title_specs_images_and_vat`: for `hero`, 3 images in order, `vat_included == Decimal("19.83")`, and the tagline.
  - `test_inactive_slug_is_not_found`
  - `test_collection_in_position_order_hides_inactive`
  - `test_product_not_found_message_for_int_ref`

  Route tests:
  - `test_page_has_total_and_facets`
  - `test_brand_query_is_repeatable`
  - `test_min_above_max_is_422`
  - `test_unknown_sort_is_422`
  - `test_no_available_field_in_listing`
  - `test_by_slug_returns_vat_as_string`
  - `test_unknown_collection_is_404`
  - `test_detail_never_includes_unit_cost`
  - `test_openapi_has_product_card_schema`

  Remove every `xfail` marker with reason `"B3"`.
- [ ] **Step 2: Run** `uv run pytest tests/domain/test_catalogue.py tests/api/test_catalogue_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement the stub bodies.**
- [ ] **Step 4: Run** `uv run pytest -q && grep -rn 'reason="B3"' tests`. Expected: everything passes, and grep finds nothing.
- [ ] **Step 5: Commit** with the message `feat(catalogue): filters, sorting, totals, facets, product detail and collections`.

---

### Task B4: Cart quote (stream `sf/b-cart`)

**Files:**
- Modify: `commercelab/domain/cart.py` (body)
- Create: `tests/domain/test_cart.py`, `tests/api/test_cart_routes.py`

**Interfaces:**
- **`quote`:**
  - Repeated ids are merged, and lines keep the order each id first appeared.
  - `quantity = min(requested, available, MAX_LINE_QUANTITY)`, and `limited = quantity < requested`.
  - A line with nothing available stays, with quantity 0 and a `0.00` total.
  - Unknown and inactive ids go in `removed`, sorted.
  - An empty cart gives all-zero totals.
  - `delivery = STANDARD_DELIVERY`.
  - It reserves nothing.

- [ ] **Step 1: Write the failing tests,** against `make_catalogue`:
  - `test_quote_prices_lines_from_the_database`
  - `test_quote_totals_and_vat`: hero × 1 and low × 2 gives subtotal and total `417.00`, and `vat_included` `69.50`.
  - `test_quote_clamps_to_available`: low × 3 gives quantity 2 and `limited` true.
  - `test_quote_clamps_to_max_line_quantity`: budget × 500 gives quantity 100, `limited` true. Its stock is 150, so the cap is what applies.
  - `test_sold_out_line_is_kept_at_zero`
  - `test_inactive_and_unknown_ids_are_removed`
  - `test_empty_quote_is_all_zero`
  - `test_quote_reserves_nothing`
  - `test_repeated_ids_merge_in_first_seen_order`

  Route tests:
  - `test_quote_route_returns_strings_and_no_unit_cost`
  - `test_quote_with_huge_quantity_is_200_and_limited`
  - `test_quote_over_200_lines_is_422`
- [ ] **Step 2: Run** `uv run pytest tests/domain/test_cart.py tests/api/test_cart_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement `quote`.**
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(cart): server-side cart quote with stock clamping`.

---

### Task B5: Guest checkout and order links (stream `sf/b-checkout`)

**Files:**
- Modify: `commercelab/domain/customers.py`, `commercelab/domain/orders.py`
- Modify: `tests/domain/test_orders.py`, `tests/domain/test_reconcile.py`, `tests/api/test_order_routes.py`
- Create: `tests/domain/test_customers.py`

**Interfaces:**
- **`customers.find_or_create`:**
  - Runs `INSERT ... ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`, then falls back to a `SELECT` by `lower(email)`.
  - Never overwrites an existing customer's name or phone.
- **`place_order(conn, *, customer_id, items, address: DeliveryAddress, idempotency_key)`:**
  - Writes the `order_addresses` row in transaction 1.
  - `request_hash(customer_id, lines, address)` hashes `dataclasses.asdict(address)` too.
  - The idempotency fast path stays first.
- **`checkout(...)`** gains `address`, and `guest_checkout` is implemented as `find_or_create`, then `checkout`.
- **`get_order(conn, order_id) -> dict`** returns `id` (internal) plus every `OrderOut` field:
  - `reference` from `order_reference`, and `token`
  - `customer_name`: the address name, else the customer name
  - `items`, with `line_total` per line
  - `subtotal` (the total, since delivery is free), `delivery` from `STANDARD_DELIVERY`, and `vat_included`
  - `address`: a dict or `None`
- **`get_order_by_token`** returns the same shape, and raises `OrderNotFound(token)`.
- **Call sites gain `address=DELIVERY`:**
  - `test_orders.py`'s `buy` and line 119, and the unknown-customer test.
  - `test_reconcile.py`'s `abandoned_checkout`, `timed_out_checkout`, and the call near line 188.
- **Tests that read `order["id"]` still work,** because `id` stays in the domain dict. Update the item-shape asserts at `test_orders.py:64` and `:72` to the new item keys, and keep the no-`unit_cost` check.

- [ ] **Step 1: Write and rewrite the failing tests.**
  - `test_customers.py`:
    - `test_creates_a_customer_once_per_email_case_insensitively`
    - `test_existing_customer_name_is_not_overwritten`
    - `test_concurrent_first_checkouts_with_one_email_create_one_customer`: `committed_db`, two threads, the same id, 1 row.
  - `test_orders.py`:
    - `test_order_keeps_the_delivery_address`
    - `test_order_items_keep_name_and_sku_after_a_rename`
    - `test_same_key_different_address_is_a_conflict`
    - `test_order_reference_format`: 7 gives `"CL-00007"`.
    - `test_get_order_by_token`, `test_unknown_token_raises`
    - `test_order_totals_include_vat_and_free_delivery`
    - `test_seeded_order_without_address_reads_back_with_none` (seeded)
  - `test_order_routes.py`:
    - Rewrite `post_checkout` and `test_malformed_checkouts_are_422` to the `contact`, `address`, `items` payload. The "price sent by client" case still expects 201.
    - `test_checkout_creates_a_paid_order`: `reference` starts with `"CL-"`, `vat_included`, `delivery == "0.00"`, `address.postcode`, `items[0].product_name`, and no `id` key.
    - `test_get_order_by_token_route`
    - `test_numeric_order_route_is_gone`: `GET /orders/1` is 404.
    - `test_invalid_email_or_postcode_is_422`
    - `test_blank_optional_address_fields_become_null`
    - `test_guest_checkout_reuses_customer_by_email`
    - `test_unknown_product_is_422`

    Remove every `reason="B5"` marker.
- [ ] **Step 2: Run** `uv run pytest tests/domain tests/api -q`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run** `uv run pytest -q && grep -rn 'reason="B5"' tests`. Expected: everything passes, and grep finds nothing.
- [ ] **Step 5: Commit** with the message `feat(checkout): guest checkout, address snapshot, order links by token`.

---

### Task B6: Database reset script (stream `sf/b-tooling`)

**Files:**
- Create: `scripts/reset_db.py`, `tests/scripts/test_reset_db.py`

**Interfaces:**
- `main(argv: list[str] | None = None) -> None`:
  - It refuses (`SystemExit`, with "Refusing to reset") unless `settings.app_env == "demo"` and the database name is `commercelab` or ends in `_e2e`.
  - Then it calls `db.create_database_if_missing`, applies `db.sql`, and runs `seed.generate(42)` and `seed.write(..., image_bytes=image_manifest.cached_bytes)` in one transaction.
  - It prints `Reset <dbname>: schema applied, seeded (seed=42)`.
  - A missing cached image surfaces `cached_bytes`'s message and exits non-zero.

- [ ] **Step 1: Write the failing tests:**
  - `test_refuses_outside_demo`
  - `test_refuses_unexpected_database_name`
  - `test_accepts_e2e_names`: check the guard function `allowed(dbname) -> bool` directly.
- [ ] **Step 2: Run** `uv run pytest tests/scripts/test_reset_db.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement `main` and `allowed`.**
- [ ] **Step 4: Run** `uv run pytest -q && uv run ruff check .`. Expected: pass.
- [ ] **Step 5: Commit** with the message `feat(dev): reset_db script for dev and e2e databases`.

---

### Task B7: Documentation (after Phase 1 merges)

**Files:**
- Modify: `docs/architecture.md`, `README.md`

- [ ] **Step 1: Update `docs/architecture.md`:**
  - The new tables, and why the address, item names and images live in PostgreSQL. Images are content-addressed by sha256, so they are immutable and cacheable.
  - The API table: the new routes, with `GET /orders/{id}` removed.
  - The rules computed in Python: VAT, stock bands, quote clamping, the order reference.
  - The guest-checkout flow. A refused checkout can leave a customer with no order, which is harmless.
  - The new scripts.
- [ ] **Step 2: Update the README's run steps.** In order: `scripts.fetch_images`, `scripts.reset_db`, `scripts.export_openapi` (re-run it after any change to `api/models.py`; a test enforces this), and `SIMULATED_DECLINE_PERCENT`.
- [ ] **Step 3: Run** `uv run pytest -q`. Expected: pass.
- [ ] **Step 4: Commit** with the message `docs: storefront backend in architecture and README`.

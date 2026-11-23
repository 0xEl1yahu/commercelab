-- CommerceLab operational schema (PostgreSQL).
-- Dev script: drops and recreates every table. Never run against real data.
--
-- Conventions
--   money       NUMERIC(12,2), single currency (GBP), prices tax-inclusive
--   timestamps  TIMESTAMPTZ, stored in UTC
--   statuses    TEXT + CHECK, so the allowed values are easy to read and change
--   ids         BIGINT identity
--
-- Deferred to the analytics phase: outbox_events, analytics_checkpoints.

BEGIN;

-- Children before parents, so this re-runs cleanly on an existing database.
DROP VIEW IF EXISTS product_availability;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS order_addresses;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS collection_products;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;


-- Storefront navigation: titles, descriptions and nav order live here, not
-- in the frontend. Slugs appear in URLs, so they are lowercase and hyphenated.
CREATE TABLE categories (
    slug         TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0
);


-- Catalogue. Products are deactivated (active = false), never deleted,
-- so historical order items keep a valid product_id.
-- specs: the product page's specification table, [{"label": ..., "value": ...}, ...].
CREATE TABLE products (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku          TEXT NOT NULL UNIQUE,
    slug         TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name         TEXT NOT NULL,
    brand        TEXT NOT NULL,
    category     TEXT NOT NULL REFERENCES categories (slug),
    tagline      TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    specs        JSONB NOT NULL DEFAULT '[]',
    price        NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    unit_cost    NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT products_specs_is_array CHECK (jsonb_typeof(specs) = 'array')
);

-- The listing filters by category, then brand.
CREATE INDEX products_category_brand_idx ON products (category, brand);


-- Image bytes live in PostgreSQL, content-addressed: the key is the sha256 of
-- the bytes, and the CHECK proves it, so a key always names the same bytes
-- (which is why GET /images/{key} can be cached forever). Built-in sha256(),
-- no extension needed. source_url, licence and credit record where a stock
-- photo came from.
CREATE TABLE images (
    sha256        TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content_type  TEXT NOT NULL
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data          BYTEA NOT NULL,
    source_url    TEXT,
    licence       TEXT,
    credit        TEXT,

    CONSTRAINT images_key_matches_bytes CHECK (sha256 = encode(sha256(data), 'hex'))
);

-- A product's gallery. Position 1 is the primary image, shown on cards.
CREATE TABLE product_images (
    product_id    BIGINT NOT NULL REFERENCES products (id),
    position      INTEGER NOT NULL CHECK (position >= 1),
    image_sha256  TEXT NOT NULL REFERENCES images (sha256),
    alt           TEXT NOT NULL,

    PRIMARY KEY (product_id, position)
);


-- Merchandising: "spotlight", "featured" and themed sets, hand-ordered.
CREATE TABLE collections (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    position     INTEGER NOT NULL
);

CREATE TABLE collection_products (
    collection_id  BIGINT NOT NULL REFERENCES collections (id),
    product_id     BIGINT NOT NULL REFERENCES products (id),
    position       INTEGER NOT NULL,

    PRIMARY KEY (collection_id, product_id)
);


CREATE TABLE customers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: Ann@x.com and ann@x.com are the same customer.
CREATE UNIQUE INDEX customers_email_lower_idx ON customers (lower(email));


-- Order lifecycle:  pending -> paid -> fulfilled
--                   pending -> cancelled
-- Refund state is derived from the refunds table, not stored as an order status.
CREATE TABLE orders (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id      BIGINT NOT NULL REFERENCES customers (id),
    status           TEXT NOT NULL DEFAULT 'pending',
    total            NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    idempotency_key  TEXT NOT NULL UNIQUE,
    request_hash     TEXT NOT NULL,
    public_token     TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT orders_status_valid
        CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled'))
);

COMMENT ON COLUMN orders.total IS
    'Amount charged, frozen at checkout. Invariant (tested): total = sum(quantity * unit_price) of its items';
COMMENT ON COLUMN orders.request_hash IS
    'Hash of the checkout request body. Same key + different hash = conflicting retry';
COMMENT ON COLUMN orders.public_token IS
    'Unguessable id for the customer''s order link (GET /orders/{token}). The numeric id is never exposed';

CREATE INDEX orders_customer_id_idx ON orders (customer_id);


-- unit_price, unit_cost, product_name and sku are snapshots at purchase time,
-- so repricing or renaming a product never changes historical orders.
CREATE TABLE order_items (
    order_id      BIGINT NOT NULL REFERENCES orders (id),
    product_id    BIGINT NOT NULL REFERENCES products (id),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    unit_cost     NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    product_name  TEXT NOT NULL,
    sku           TEXT NOT NULL,

    PRIMARY KEY (order_id, product_id)
);

CREATE INDEX order_items_product_id_idx ON order_items (product_id);


-- The delivery address as it was at checkout, one per order. Copied, not
-- referenced, for the same reason prices are: an order keeps what was true
-- when it was placed. Seeded historical orders have none.
CREATE TABLE order_addresses (
    order_id    BIGINT PRIMARY KEY REFERENCES orders (id),
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    company     TEXT,
    vat_number  TEXT,
    line1       TEXT NOT NULL,
    line2       TEXT,
    city        TEXT NOT NULL,
    postcode    TEXT NOT NULL,
    country     TEXT NOT NULL DEFAULT 'GB' CHECK (country = 'GB')
);


-- Current stock per product. available = on_hand - reserved.
-- Invariant (tested): on_hand = sum(stock_movements.quantity_delta) for the product.
CREATE TABLE inventory (
    product_id  BIGINT PRIMARY KEY REFERENCES products (id),
    on_hand     INTEGER NOT NULL DEFAULT 0,
    reserved    INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT inventory_on_hand_non_negative  CHECK (on_hand >= 0),
    CONSTRAINT inventory_reserved_non_negative CHECK (reserved >= 0),
    CONSTRAINT inventory_reserved_within_stock CHECK (reserved <= on_hand)
);

-- The single definition of "available". inventory.py owns the rule; catalogue
-- and reports read this view instead of repeating the arithmetic, so a future
-- change (e.g. ignoring expired reservations) happens in one place.
CREATE VIEW product_availability AS
SELECT product_id, on_hand, reserved, on_hand - reserved AS available
FROM inventory;


-- One row per order line held against stock. Status moves exactly once:
-- active -> committed (payment succeeded) or active -> released (failed / cancelled / expired).
-- expires_at: checkout sets it (RESERVATION_HOLD_MINUTES). NULL means the hold
-- never expires (e.g. seeded data). An expired hold still counts against stock
-- until reconciliation releases it, and is only released once the payment
-- provider confirms the customer wasn't charged.
CREATE TABLE reservations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES orders (id),
    product_id  BIGINT NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    status      TEXT NOT NULL DEFAULT 'active',
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT reservations_status_valid
        CHECK (status IN ('active', 'committed', 'released')),
    CONSTRAINT reservations_order_product_unique
        UNIQUE (order_id, product_id)
);

CREATE INDEX reservations_product_id_idx ON reservations (product_id);

-- Finds holds that have run out, for scripts/reconcile.py. Partial: only
-- active reservations can expire, and they are a small share of the table.
CREATE INDEX reservations_active_expiry_idx
    ON reservations (expires_at) WHERE status = 'active';


-- Append-only audit log of every change to on_hand.
-- Reserving stock does not create a movement; committing a sale does.
CREATE TABLE stock_movements (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES products (id),
    quantity_delta  INTEGER NOT NULL CHECK (quantity_delta <> 0),
    reason          TEXT NOT NULL,
    order_id        BIGINT REFERENCES orders (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT stock_movements_reason_valid
        CHECK (reason IN ('restock', 'sale', 'return', 'adjustment')),
    CONSTRAINT stock_movements_sale_has_order
        CHECK (reason <> 'sale' OR order_id IS NOT NULL)
);

CREATE INDEX stock_movements_product_id_idx ON stock_movements (product_id);


-- 'unknown' = the provider did not give a definite answer (timeout, crash).
-- It must be reconciled later, never assumed to be a failure.
CREATE TABLE payments (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id            BIGINT NOT NULL REFERENCES orders (id),
    amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status              TEXT NOT NULL DEFAULT 'pending',
    provider_reference  TEXT UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT payments_status_valid
        CHECK (status IN ('pending', 'succeeded', 'failed', 'unknown'))
);

CREATE INDEX payments_order_id_idx ON payments (order_id);

-- An order can have several failed attempts but at most one successful charge.
CREATE UNIQUE INDEX payments_one_success_per_order_idx
    ON payments (order_id) WHERE status = 'succeeded';


-- Refunds attach to the charge they reverse. The order is reachable via payment.
-- "sum(refunds) <= payment.amount" spans rows, so payments.py enforces it
-- inside a transaction that locks the payment row (SELECT ... FOR UPDATE).
CREATE TABLE refunds (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id  BIGINT NOT NULL REFERENCES payments (id),
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status      TEXT NOT NULL DEFAULT 'pending',
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT refunds_status_valid
        CHECK (status IN ('pending', 'succeeded', 'failed'))
);

CREATE INDEX refunds_payment_id_idx ON refunds (payment_id);

COMMIT;

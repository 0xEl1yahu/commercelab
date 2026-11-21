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

DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS products;


-- Catalogue. Products are deactivated (active = false), never deleted,
-- so historical order items keep a valid product_id.
CREATE TABLE products (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    unit_cost   NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE customers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
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
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT orders_status_valid
        CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled'))
);

COMMENT ON COLUMN orders.total IS
    'Amount charged, frozen at checkout. Invariant (tested): total = sum(quantity * unit_price) of its items';
COMMENT ON COLUMN orders.request_hash IS
    'Hash of the checkout request body. Same key + different hash = conflicting retry';

CREATE INDEX orders_customer_id_idx ON orders (customer_id);


-- unit_price and unit_cost are snapshots at purchase time,
-- so repricing a product never changes historical orders.
CREATE TABLE order_items (
    order_id    BIGINT NOT NULL REFERENCES orders (id),
    product_id  BIGINT NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    unit_cost   NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),

    PRIMARY KEY (order_id, product_id)
);

CREATE INDEX order_items_product_id_idx ON order_items (product_id);


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


-- One row per order line held against stock. Status moves exactly once:
-- active -> committed (payment succeeded) or active -> released (failed / cancelled / expired).
-- expires_at NULL means no expiry; the expiry policy is still undecided.
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

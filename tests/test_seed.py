"""Tests for scripts/seed.py: reproducibility, safety and data invariants."""

import psycopg
import pytest

from config import settings
from scripts import seed

TABLES = [
    "products", "customers", "orders", "order_items", "inventory",
    "reservations", "stock_movements", "payments", "refunds",
]


def snapshot(conn: psycopg.Connection) -> dict[str, list[tuple]]:
    """Every row of every table, in a stable order (ORDER BY the whole row)."""
    return {t: conn.execute(f"SELECT * FROM {t} ORDER BY {t}").fetchall() for t in TABLES}


# --- reproducibility -----------------------------------------------------------

def test_same_seed_generates_identical_data():
    assert seed.generate(42) == seed.generate(42)


def test_different_seed_generates_different_data():
    assert seed.generate(42) != seed.generate(7)


def test_seeding_twice_writes_identical_tables(conn):
    seed.write(conn, *seed.generate(42))
    first = snapshot(conn)
    seed.write(conn, *seed.generate(42))  # TRUNCATE ... RESTART IDENTITY, then reload
    assert snapshot(conn) == first


def test_database_matches_the_plan(conn, seeded):
    products, customers, data = seeded
    planned = {"products": len(products), "customers": len(customers),
               **{t: len(data[t]) for t in TABLES if t in data}}
    actual = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
    assert actual == planned
    assert actual["orders"] == seed.N_ORDERS
    assert actual["customers"] == seed.N_CUSTOMERS


# --- safety ----------------------------------------------------------------------

def test_refuses_to_run_outside_demo(monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("seed connected to a database while APP_ENV=live")

    monkeypatch.setattr(settings, "app_env", "live")
    monkeypatch.setattr(seed.db, "connect", fail_if_called)

    with pytest.raises(SystemExit, match="Refusing to seed"):
        seed.main([])


# --- invariants the schema cannot enforce on its own ---------------------------
# Each query counts violating rows, so every one must return 0.

INVARIANTS = {
    "order total equals sum of its items": """
        SELECT count(*) FROM orders o
        WHERE o.total <> (SELECT sum(quantity * unit_price)
                          FROM order_items i WHERE i.order_id = o.id)
    """,
    "on_hand equals sum of stock movements": """
        SELECT count(*) FROM inventory v
        WHERE v.on_hand <> (SELECT sum(quantity_delta)
                            FROM stock_movements m WHERE m.product_id = v.product_id)
    """,
    "reserved equals sum of active reservations": """
        SELECT count(*) FROM inventory v
        WHERE v.reserved <> (SELECT coalesce(sum(quantity), 0) FROM reservations r
                             WHERE r.product_id = v.product_id AND r.status = 'active')
    """,
    "refunds never exceed the payment": """
        SELECT count(*) FROM payments p
        WHERE (SELECT coalesce(sum(amount), 0) FROM refunds r WHERE r.payment_id = p.id)
              > p.amount
    """,
    "paid and fulfilled orders have exactly one successful payment": """
        SELECT count(*) FROM orders o
        WHERE o.status IN ('paid', 'fulfilled')
          AND (SELECT count(*) FROM payments p
               WHERE p.order_id = o.id AND p.status = 'succeeded') <> 1
    """,
    "pending and cancelled orders have not deducted stock": """
        SELECT count(*) FROM orders o
        WHERE o.status IN ('pending', 'cancelled')
          AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.order_id = o.id)
    """,
    "items ordered after the reprice use the current price": """
        SELECT count(*) FROM order_items i
        JOIN orders o ON o.id = i.order_id
        JOIN products p ON p.id = i.product_id
        WHERE o.created_at >= '2026-07-01' AND i.unit_price <> p.price
    """,
}


@pytest.mark.parametrize("query", INVARIANTS.values(), ids=INVARIANTS.keys())
def test_seeded_data_satisfies_invariant(conn, seeded, query):
    assert conn.execute(query).fetchone()[0] == 0


# --- scenario data other tests and exercises rely on ---------------------------

def test_repriced_products_keep_old_prices_in_history(conn, seeded):
    repriced = conn.execute("""
        SELECT count(DISTINCT p.id) FROM products p
        JOIN order_items i ON i.product_id = p.id
        WHERE i.unit_price < p.price
    """).fetchone()[0]
    assert repriced == seed.N_REPRICED


def test_limited_keyboard_has_exactly_two_available(conn, seeded):
    on_hand, reserved = conn.execute("""
        SELECT v.on_hand, v.reserved FROM inventory v
        JOIN products p ON p.id = v.product_id WHERE p.sku = %s
    """, [seed.LIMITED_SKU]).fetchone()
    assert (on_hand, reserved) == (2, 0)


def test_every_order_state_is_represented(conn, seeded):
    statuses = {row[0] for row in conn.execute("SELECT DISTINCT status FROM orders")}
    payment_statuses = {row[0] for row in conn.execute("SELECT DISTINCT status FROM payments")}
    assert statuses == {"pending", "paid", "fulfilled", "cancelled"}
    assert {"succeeded", "failed", "unknown"} <= payment_statuses

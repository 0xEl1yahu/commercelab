"""Tests for data/db.sql: every constraint rejects what it should, and only that.

Each rejected case names the constraint expected to fire. Checking only that
"an error happened" is not enough: a row can fail for an unrelated reason
(e.g. a missing foreign key) and the test would still pass.
"""

import pytest
from psycopg import errors


@pytest.fixture
def base(conn) -> dict[str, int]:
    """One valid row in each core table. Returns their ids for the statements below.

    Ids come from RETURNING, never hardcoded: rolled-back transactions don't
    reset identity sequences, so the first product is not always id 1.
    """
    def insert(sql: str, params: dict | None = None) -> int:
        return conn.execute(sql + " RETURNING id", params).fetchone()[0]

    ids = {}
    ids["product_id"] = insert(
        "INSERT INTO products (sku, name, category, price, unit_cost) "
        "VALUES ('MUG', 'Mug', 'kitchen', 8.50, 3.10)")
    ids["customer_id"] = insert(
        "INSERT INTO customers (name, email) VALUES ('Ann', 'Ann@x.com')")
    conn.execute("INSERT INTO inventory (product_id, on_hand) VALUES (%(product_id)s, 5)", ids)
    ids["order_id"] = insert(
        "INSERT INTO orders (customer_id, total, idempotency_key, request_hash) "
        "VALUES (%(customer_id)s, 17.00, 'k1', 'h1')", ids)
    conn.execute(
        "INSERT INTO order_items VALUES (%(order_id)s, %(product_id)s, 2, 8.50, 3.10)", ids)
    ids["payment_id"] = insert(
        "INSERT INTO payments (order_id, amount, status) "
        "VALUES (%(order_id)s, 17.00, 'succeeded')", ids)
    return ids


# Every statement uses at least one %(name)s placeholder, filled from `base`.

REJECTED = [
    # (test id, statement, expected error, expected constraint name)
    ("duplicate email, different case",
     ("INSERT INTO customers (name, email) "
     "SELECT 'A2', 'ann@X.COM' WHERE %(customer_id)s IS NOT NULL"),
     errors.UniqueViolation, "customers_email_lower_idx"),
    ("negative price",
     "UPDATE products SET price = -1 WHERE id = %(product_id)s",
     errors.CheckViolation, "products_price_check"),
    ("negative unit cost",
     "UPDATE products SET unit_cost = -0.01 WHERE id = %(product_id)s",
     errors.CheckViolation, "products_unit_cost_check"),
    ("duplicate sku",
     ("INSERT INTO products (sku, name, category, price, unit_cost) "
     "SELECT sku, 'Copy', category, price, unit_cost FROM products WHERE id = %(product_id)s"),
     errors.UniqueViolation, "products_sku_key"),
    ("invalid order status",
     "UPDATE orders SET status = 'shipped' WHERE id = %(order_id)s",
     errors.CheckViolation, "orders_status_valid"),
    ("retry with same idempotency key",
     ("INSERT INTO orders (customer_id, total, idempotency_key, request_hash) "
     "VALUES (%(customer_id)s, 1, 'k1', 'h1')"),
     errors.UniqueViolation, "orders_idempotency_key_key"),
    ("order for missing customer",
     ("INSERT INTO orders (customer_id, total, idempotency_key, request_hash) "
     "VALUES (%(customer_id)s + 1000, 1, 'k2', 'h')"),
     errors.ForeignKeyViolation, "orders_customer_id_fkey"),
    ("order item quantity 0",
     "UPDATE order_items SET quantity = 0 WHERE order_id = %(order_id)s",
     errors.CheckViolation, "order_items_quantity_check"),
    ("same product twice in one order",
     "INSERT INTO order_items VALUES (%(order_id)s, %(product_id)s, 1, 8.50, 3.10)",
     errors.UniqueViolation, "order_items_pkey"),
    ("stock below zero",
     "UPDATE inventory SET on_hand = -1 WHERE product_id = %(product_id)s",
     errors.CheckViolation, "inventory_on_hand_non_negative"),
    ("reserve more than on hand",
     "UPDATE inventory SET reserved = 6 WHERE product_id = %(product_id)s",
     errors.CheckViolation, "inventory_reserved_within_stock"),
    ("duplicate reservation for an order line",
     ("INSERT INTO reservations (order_id, product_id, quantity) "
     "VALUES (%(order_id)s, %(product_id)s, 2), (%(order_id)s, %(product_id)s, 1)"),
     errors.UniqueViolation, "reservations_order_product_unique"),
    ("invalid reservation status",
     ("INSERT INTO reservations (order_id, product_id, quantity, status) "
     "VALUES (%(order_id)s, %(product_id)s, 1, 'expired')"),
     errors.CheckViolation, "reservations_status_valid"),
    ("zero stock movement",
     ("INSERT INTO stock_movements (product_id, quantity_delta, reason) "
     "VALUES (%(product_id)s, 0, 'restock')"),
     errors.CheckViolation, "stock_movements_quantity_delta_check"),
    ("sale movement with no order",
     ("INSERT INTO stock_movements (product_id, quantity_delta, reason) "
     "VALUES (%(product_id)s, -2, 'sale')"),
     errors.CheckViolation, "stock_movements_sale_has_order"),
    ("second successful payment for an order",
     "INSERT INTO payments (order_id, amount, status) VALUES (%(order_id)s, 17.00, 'succeeded')",
     errors.UniqueViolation, "payments_one_success_per_order_idx"),
    ("zero payment amount",
     "INSERT INTO payments (order_id, amount) VALUES (%(order_id)s, 0)",
     errors.CheckViolation, "payments_amount_check"),
    ("invalid payment status",
     "UPDATE payments SET status = 'refunded' WHERE id = %(payment_id)s",
     errors.CheckViolation, "payments_status_valid"),
    ("zero refund",
     "INSERT INTO refunds (payment_id, amount) VALUES (%(payment_id)s, 0)",
     errors.CheckViolation, "refunds_amount_check"),
    # products is referenced by several tables; any of their foreign keys may fire first.
    ("delete product with order history",
     "DELETE FROM products WHERE id = %(product_id)s",
     errors.ForeignKeyViolation, None),
]

ACCEPTED = [
    ("two products in the same category",
     ("INSERT INTO products (sku, name, category, price, unit_cost) "
     "SELECT 'MUG-2', 'Big mug', category, 9.50, 3.40 FROM products WHERE id = %(product_id)s")),
    ("zero price",
     "UPDATE products SET price = 0 WHERE id = %(product_id)s"),
    ("reserve all stock on hand",
     "UPDATE inventory SET reserved = 5 WHERE product_id = %(product_id)s"),
    ("sale movement with an order",
     ("INSERT INTO stock_movements (product_id, quantity_delta, reason, order_id) "
     "VALUES (%(product_id)s, -2, 'sale', %(order_id)s)")),
    ("failed payment retry after a success",
     "INSERT INTO payments (order_id, amount, status) VALUES (%(order_id)s, 17.00, 'failed')"),
    ("payment with unknown outcome",
     "INSERT INTO payments (order_id, amount, status) VALUES (%(order_id)s, 17.00, 'unknown')"),
    ("partial refund",
     "INSERT INTO refunds (payment_id, amount) VALUES (%(payment_id)s, 5.00)"),
    ("deactivate a product with order history",
     "UPDATE products SET active = false WHERE id = %(product_id)s"),
]


@pytest.mark.parametrize(
    ("statement", "error", "constraint"),
    [pytest.param(sql, err, name, id=case) for case, sql, err, name in REJECTED],
)
def test_constraint_rejects(conn, base, statement, error, constraint):
    with pytest.raises(error) as raised:
        conn.execute(statement, base)
    if constraint is not None:
        assert raised.value.diag.constraint_name == constraint


@pytest.mark.parametrize(
    "statement", [pytest.param(sql, id=case) for case, sql in ACCEPTED]
)
def test_constraint_accepts(conn, base, statement):
    conn.execute(statement, base)  # raises, and fails the test, if any constraint fires


def test_new_rows_get_safe_defaults(conn, base):
    product = conn.execute(
        "SELECT active, created_at IS NOT NULL FROM products WHERE id = %(product_id)s", base
    ).fetchone()
    order_status = conn.execute(
        "SELECT status FROM orders WHERE id = %(order_id)s", base).fetchone()[0]
    reserved = conn.execute(
        "SELECT reserved FROM inventory WHERE product_id = %(product_id)s", base).fetchone()[0]
    assert product == (True, True)
    assert order_status == "pending"
    assert reserved == 0


def test_every_table_exists(conn):
    tables = {row[0] for row in conn.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")}
    assert tables == {
        "products", "customers", "orders", "order_items", "inventory",
        "reservations", "stock_movements", "payments", "refunds",
    }


def test_product_availability_view_is_on_hand_minus_reserved(conn, base):
    conn.execute("UPDATE inventory SET reserved = 3 WHERE product_id = %(product_id)s", base)
    row = conn.execute(
        "SELECT on_hand, reserved, available FROM product_availability "
        "WHERE product_id = %(product_id)s", base).fetchone()
    assert row == (5, 3, 2)


def test_money_columns_are_exact_numeric(conn):
    """Money must be NUMERIC(12,2), never float: 0.1 + 0.2 must equal 0.3 exactly."""
    money_columns = conn.execute("""
        SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('price', 'unit_cost', 'unit_price', 'total', 'amount')
    """).fetchall()
    assert len(money_columns) == 7
    for table, column, data_type, precision, scale in money_columns:
        assert (data_type, precision, scale) == ("numeric", 12, 2), f"{table}.{column}"

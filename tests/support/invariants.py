"""Rules every valid CommerceLab database satisfies, whatever produced the data.

These span several rows or tables, so CHECK constraints can't enforce them.
Each query counts violating rows: 0 means the rule holds.

Run them after any test that changes stock, orders or payments, so the real
domain code (not just the seed) is shown to keep them.

coalesce(sum(...), 0) matters: sum() over zero rows is NULL, and `x <> NULL`
is never true, so without it an inventory row with no movements at all, or an
order with no items, would silently pass.
"""

import psycopg

INVARIANTS = {
    "order total equals sum of its items": """
        SELECT count(*) FROM orders o
        WHERE o.total <> (SELECT coalesce(sum(quantity * unit_price), 0)
                          FROM order_items i WHERE i.order_id = o.id)
    """,
    "on_hand equals sum of stock movements": """
        SELECT count(*) FROM inventory v
        WHERE v.on_hand <> (SELECT coalesce(sum(quantity_delta), 0)
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
}

# The two rules inventory.py alone is responsible for.
STOCK_INVARIANTS = (
    "on_hand equals sum of stock movements",
    "reserved equals sum of active reservations",
)


def violations(conn: psycopg.Connection, names=None) -> dict[str, int]:
    """Violation count per rule. Compare against {name: 0 ...} for a readable diff."""
    return {name: conn.execute(INVARIANTS[name]).fetchone()[0] for name in names or INVARIANTS}


def assert_all_hold(conn: psycopg.Connection) -> None:
    """Every rule holds: orders, payments and stock agree with each other."""
    result = violations(conn)
    assert result == {name: 0 for name in result}

"""Stock: what can be sold, what is held for checkouts, and every change to it.

This module owns the stock rules:
  - never hold more units than are available (available = on_hand - reserved)
  - a reservation is settled exactly once: sold or released, never both
  - every change to on_hand is recorded in stock_movements

Every function takes a connection and wraps its work in `conn.transaction()`.
Inside a caller's transaction (orders.py reserving each line of a checkout),
that becomes a savepoint, so one failed line can roll back the whole order.

Callers that reserve several products in one transaction should reserve them
in product_id order. Two checkouts that lock the same rows in opposite orders
can deadlock; a consistent order prevents it.
"""

from datetime import timedelta

import psycopg


class InsufficientStock(Exception):
    """Not enough available units. `available` is the count at the moment of refusal."""

    def __init__(self, product_id: int, requested: int, available: int):
        super().__init__(
            f"Product {product_id}: requested {requested}, only {available} available"
        )
        self.product_id = product_id
        self.requested = requested
        self.available = available


class ReservationNotActive(Exception):
    """The reservation doesn't exist, or was already sold or released."""

    def __init__(self, reservation_id: int):
        super().__init__(f"Reservation {reservation_id} is not active")
        self.reservation_id = reservation_id


def _require_positive(quantity: int) -> None:
    if quantity <= 0:
        raise ValueError(f"quantity must be positive, got {quantity}")


def _available(conn: psycopg.Connection, product_id: int) -> int:
    row = conn.execute(
        "SELECT available FROM product_availability WHERE product_id = %s", [product_id]
    ).fetchone()
    return row[0] if row else 0


def reserve(
    conn: psycopg.Connection,
    order_id: int,
    product_id: int,
    quantity: int,
    *,
    hold: timedelta | None = None,
) -> int:
    """Hold `quantity` units for an order. Returns the reservation id.

    `hold` sets when the reservation expires, measured from the database's
    clock (now() + hold), so every process agrees on the time. None means it
    never expires. Expiry doesn't release anything by itself: see
    orders.reconcile.

    Raises InsufficientStock if fewer than `quantity` units are available.
    """
    _require_positive(quantity)
    with conn.transaction():
        # Check and take in ONE statement. Postgres locks the row while it runs,
        # so a concurrent reserve() for the same product waits, then re-evaluates
        # the WHERE against the new numbers. A separate "SELECT available, then
        # UPDATE" lets two checkouts both pass the check before either takes.
        # (on_hand - reserved must match the product_availability view.)
        taken = conn.execute(
            "UPDATE inventory SET reserved = reserved + %(q)s, updated_at = now() "
            "WHERE product_id = %(p)s AND on_hand - reserved >= %(q)s "
            "RETURNING product_id",
            {"q": quantity, "p": product_id},
        ).fetchone()
        if taken is None:
            # Read after the refusal, for the error message only: by the time
            # the caller sees it, this number may already have changed.
            raise InsufficientStock(product_id, quantity, _available(conn, product_id))
        # now() + NULL is NULL, so hold=None stores "never expires".
        return conn.execute(
            "INSERT INTO reservations (order_id, product_id, quantity, expires_at) "
            "VALUES (%s, %s, %s, now() + %s::interval) RETURNING id",
            [order_id, product_id, quantity, hold],
        ).fetchone()[0]


def release(conn: psycopg.Connection, reservation_id: int) -> None:
    """Give held units back (payment failed, order cancelled, reservation expired)."""
    with conn.transaction():
        # The status check is part of the UPDATE, so two concurrent settlements
        # can't both see 'active': the second waits for the first, then matches 0 rows.
        row = conn.execute(
            "UPDATE reservations SET status = 'released' "
            "WHERE id = %s AND status = 'active' RETURNING product_id, quantity",
            [reservation_id],
        ).fetchone()
        if row is None:
            raise ReservationNotActive(reservation_id)
        product_id, quantity = row
        conn.execute(
            "UPDATE inventory SET reserved = reserved - %s, updated_at = now() "
            "WHERE product_id = %s",
            [quantity, product_id],
        )


def convert_to_sale(conn: psycopg.Connection, reservation_id: int) -> None:
    """Payment succeeded: the held units leave stock, recorded as a sale."""
    with conn.transaction():
        row = conn.execute(
            "UPDATE reservations SET status = 'committed' "
            "WHERE id = %s AND status = 'active' RETURNING order_id, product_id, quantity",
            [reservation_id],
        ).fetchone()
        if row is None:
            raise ReservationNotActive(reservation_id)
        order_id, product_id, quantity = row
        conn.execute(
            "UPDATE inventory SET on_hand = on_hand - %(q)s, reserved = reserved - %(q)s, "
            "updated_at = now() WHERE product_id = %(p)s",
            {"q": quantity, "p": product_id},
        )
        conn.execute(
            "INSERT INTO stock_movements (product_id, quantity_delta, reason, order_id) "
            "VALUES (%s, %s, 'sale', %s)",
            [product_id, -quantity, order_id],
        )


def restock(conn: psycopg.Connection, product_id: int, quantity: int) -> None:
    """Add units to stock, creating the product's inventory row if needed."""
    _require_positive(quantity)
    with conn.transaction():
        conn.execute(
            "INSERT INTO inventory (product_id, on_hand) VALUES (%(p)s, %(q)s) "
            "ON CONFLICT (product_id) DO UPDATE "
            "SET on_hand = inventory.on_hand + EXCLUDED.on_hand, updated_at = now()",
            {"p": product_id, "q": quantity},
        )
        conn.execute(
            "INSERT INTO stock_movements (product_id, quantity_delta, reason) "
            "VALUES (%s, %s, 'restock')",
            [product_id, quantity],
        )

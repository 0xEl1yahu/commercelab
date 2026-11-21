"""Orders: checkout and the order lifecycle.

This module owns the ORDER rules and orchestrates the others:
  - an order is all-or-nothing: if any line can't be reserved, nothing is created
  - prices and costs come from the database at checkout, never from the client,
    and are frozen on the order items
  - a retried checkout (same idempotency key, same cart) returns the original
    order and never charges twice; the same key with a different cart is refused
  - lifecycle:  pending -> paid       (payment succeeded: reserved stock is sold)
                pending -> cancelled  (payment declined: reserved stock is released)
                pending stays pending (payment outcome unknown: stock stays held)

Stock rules belong to inventory.py; the payments table and provider to payments.py.

CHECKOUT IN THREE STEPS
  1. place_order: one transaction creates the order, its items, its delivery
     address, every reservation and a pending payment, then COMMITS.
  2. pay_order: calls the payment provider with NO transaction open. A remote
     call can take seconds; holding row locks that long would block every
     other checkout for the same products.
  3. pay_order, second transaction: records the outcome and settles the stock.

A crash between steps leaves a pending order with a pending payment. Retrying
the same checkout resumes at step 2, which is safe because the provider charges
at most once per payment key.
"""

import dataclasses
import hashlib
import json
from collections.abc import Iterable
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal, NamedTuple

import psycopg
from psycopg.rows import dict_row

from commercelab.config import settings
from commercelab.domain import customers, inventory, payments
from commercelab.domain.customers import Contact, DeliveryAddress
from commercelab.domain.pricing import STANDARD_DELIVERY, vat_included


class OrderNotFound(Exception):
    """No order has this id (int, internal) or public token (str). The route gives 404."""

    def __init__(self, ref: int | str):
        if isinstance(ref, int):
            message = f"No order with id {ref}"
        else:
            message = f"No order {ref!r}"
        super().__init__(message)
        self.ref = ref


class CustomerNotFound(Exception):
    def __init__(self, customer_id: int):
        super().__init__(f"No customer with id {customer_id}")
        self.customer_id = customer_id


class ProductUnavailable(Exception):
    """One or more products don't exist or are no longer sold."""

    def __init__(self, product_ids: list[int]):
        super().__init__(f"Products not available: {product_ids}")
        self.product_ids = product_ids


class IdempotencyConflict(Exception):
    """The key was already used for a different checkout request."""

    def __init__(self, key: str):
        super().__init__(f"Idempotency key {key!r} was already used for a different request")
        self.key = key


class OrderStateError(Exception):
    """An order wasn't in the state a transition requires. Indicates a bug."""


class CheckoutResult(NamedTuple):
    order: dict
    created: bool  # False when this was a retry of an earlier checkout


def order_reference(order_id: int) -> str:
    """The reference a customer sees: CL- and the id padded to 5 digits (7 -> "CL-00007")."""
    return f"CL-{order_id:05d}"


# --- request normalisation ----------------------------------------------------------

def normalise_items(items: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge repeated products and sort by product_id.

    Sorting gives a canonical form (so a retry with the lines in another order
    is the same request) and a consistent lock order when reserving (two
    checkouts locking the same products in opposite orders could deadlock).
    """
    merged: dict[int, int] = {}
    for product_id, quantity in items:
        if quantity <= 0:
            raise ValueError(f"quantity must be positive, got {quantity}")
        merged[product_id] = merged.get(product_id, 0) + quantity
    if not merged:
        raise ValueError("an order needs at least one item")
    return sorted(merged.items())


def request_hash(
    customer_id: int, lines: list[tuple[int, int]], address: DeliveryAddress
) -> str:
    """The fingerprint of a checkout request: who, what, and where it goes.

    The address is part of it, so a retry with the same key but a changed
    address is a conflict, not a silent return of the order going elsewhere.
    """
    body = {
        "customer_id": customer_id,
        "items": [list(line) for line in lines],
        "address": dataclasses.asdict(address),
    }
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


# --- step 1: place the order -------------------------------------------------------

def _existing_order(conn: psycopg.Connection, key: str, fingerprint: str) -> int | None:
    row = conn.execute(
        "SELECT id, request_hash FROM orders WHERE idempotency_key = %s", [key]
    ).fetchone()
    if row is None:
        return None
    order_id, stored_fingerprint = row
    if stored_fingerprint != fingerprint:
        raise IdempotencyConflict(key)
    return order_id


def _current_prices(
    conn: psycopg.Connection, product_ids: list[int]
) -> dict[int, tuple[Decimal, Decimal, str, str]]:
    """(price, unit_cost, name, sku) per product: everything an order item snapshots."""
    rows = conn.execute(
        "SELECT id, price, unit_cost, name, sku FROM products WHERE id = ANY(%s) AND active",
        [product_ids],
    ).fetchall()
    prices = {product_id: (price, cost, name, sku) for product_id, price, cost, name, sku in rows}
    missing = [p for p in product_ids if p not in prices]
    if missing:
        raise ProductUnavailable(missing)
    return prices


def place_order(
    conn: psycopg.Connection,
    *,
    customer_id: int,
    items: Iterable[tuple[int, int]],
    address: DeliveryAddress,
    idempotency_key: str,
) -> tuple[int, bool]:
    """Create a pending order with its stock reserved and a pending payment.

    Returns (order_id, created). created is False for a retry, in which case
    nothing is written. Raises InsufficientStock (and creates nothing) if any
    line can't be reserved; the key stays unused, so the same checkout can be
    retried later.

    The stock is held for settings.reservation_hold_minutes; see reconcile().
    """
    lines = normalise_items(items)
    fingerprint = request_hash(customer_id, lines, address)
    hold = timedelta(minutes=settings.reservation_hold_minutes)

    with conn.transaction():
        # Fast path for retries. Checked before validation, so a retry still
        # gets its order back even if a product has since been discontinued.
        existing = _existing_order(conn, idempotency_key, fingerprint)
        if existing is not None:
            return existing, False

        if conn.execute("SELECT 1 FROM customers WHERE id = %s", [customer_id]).fetchone() is None:
            raise CustomerNotFound(customer_id)
        prices = _current_prices(conn, [product_id for product_id, _ in lines])
        total = sum((prices[p][0] * q for p, q in lines), Decimal("0.00"))
        if total <= 0:
            raise ValueError("order total must be positive")

        # Decide "first request or retry?" in one statement. If a concurrent
        # request with the same key is mid-checkout, this waits for it: if it
        # commits we get nothing back and return its order; if it rolls back,
        # this insert goes ahead.
        inserted = conn.execute(
            "INSERT INTO orders (customer_id, total, idempotency_key, request_hash) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
            [customer_id, total, idempotency_key, fingerprint],
        ).fetchone()
        if inserted is None:
            return _existing_order(conn, idempotency_key, fingerprint), False
        order_id = inserted[0]

        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO order_items "
                "(order_id, product_id, quantity, unit_price, unit_cost, product_name, sku) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                [(order_id, p, q, *prices[p]) for p, q in lines],
            )
        conn.execute(
            "INSERT INTO order_addresses "
            "(order_id, name, phone, company, vat_number, line1, line2, city, postcode, country) "
            "VALUES (%(order_id)s, %(name)s, %(phone)s, %(company)s, %(vat_number)s, "
            "%(line1)s, %(line2)s, %(city)s, %(postcode)s, %(country)s)",
            {"order_id": order_id, **dataclasses.asdict(address)},
        )
        for product_id, quantity in lines:  # already in product_id order
            inventory.reserve(conn, order_id, product_id, quantity, hold=hold)
        payments.create_pending(conn, order_id, total)

    return order_id, True


# --- steps 2 and 3: pay and settle -------------------------------------------------

def _transition(conn: psycopg.Connection, order_id: int, from_status: str, to_status: str) -> None:
    moved = conn.execute(
        "UPDATE orders SET status = %s WHERE id = %s AND status = %s RETURNING id",
        [to_status, order_id, from_status],
    ).fetchone()
    if moved is None:
        raise OrderStateError(f"Order {order_id} is not {from_status!r}; can't make it {to_status!r}")


def _settle(
    conn: psycopg.Connection, order_id: int, payment_id: int, charge: payments.Charge
) -> bool:
    """Record the payment outcome and settle the stock. False if already settled."""
    with conn.transaction():
        if not payments.record_outcome(conn, payment_id, charge.outcome, charge.reference):
            return False  # a concurrent retry settled it first; nothing left to do
        reservation_ids = [row[0] for row in conn.execute(
            "SELECT id FROM reservations WHERE order_id = %s AND status = 'active' "
            "ORDER BY product_id",
            [order_id],
        )]
        if charge.outcome == "succeeded":
            _transition(conn, order_id, "pending", "paid")
            for reservation_id in reservation_ids:
                inventory.convert_to_sale(conn, reservation_id)
        else:
            _transition(conn, order_id, "pending", "cancelled")
            for reservation_id in reservation_ids:
                inventory.release(conn, reservation_id)
    return True


def pay_order(conn: psycopg.Connection, provider: payments.PaymentProvider, order_id: int) -> None:
    """Charge the order's open payment and settle it. A no-op if already settled.

    Must be called with no transaction open (see the module docstring).
    """
    open_payment = payments.open_payment(conn, order_id)
    if open_payment is None:
        return
    payment_id, amount = open_payment
    try:
        charge = provider.charge(idempotency_key=payments.idempotency_key(payment_id), amount=amount)
    # Deliberately broad: whatever went wrong talking to the provider, we don't
    # know whether the customer was charged. That is 'unknown', never 'failed'.
    except Exception:  # noqa: BLE001
        payments.mark_unknown(conn, payment_id)
        return
    _settle(conn, order_id, payment_id, charge)


# --- reconciliation: orders left pending ---------------------------------------------
#
# An order stays pending when its payment outcome is unknown (the provider
# timed out) or was never requested (a crash after step 1), and the customer
# didn't retry. Its stock stays held. reconcile() is the job that resolves them.
#
# It asks the provider with lookup(), never charge(): charging an abandoned
# cart would bill a customer who has gone. Then:
#   provider has a definite answer -> settle accordingly (even after the hold
#                                     expired: if they paid, they get the order)
#   provider never saw the payment -> cancel and release, once the hold expires
#   provider unreachable           -> leave it; try again next run. Releasing
#                                     stock the customer may have paid for is
#                                     worse than holding it a little longer.
#
# Known gap: if a customer retry is charging at the same moment reconcile
# cancels the order, the charge can land on a cancelled order. Both settle
# through record_outcome, so the database stays consistent, but the money would
# need a refund, which isn't built yet.

ReconcileResult = Literal["paid", "cancelled", "unchanged"]


class ReconcileCandidate(NamedTuple):
    order_id: int
    payment_id: int
    payment_status: str
    hold_expired: bool


def reconcile_candidates(
    conn: psycopg.Connection, *, as_of: datetime | None = None
) -> list[ReconcileCandidate]:
    """Pending orders worth asking the provider about.

    Those whose payment outcome is unknown, and those whose hold has expired.
    as_of defaults to the database's now(); tests pass a later time instead of
    waiting for real minutes to pass.
    """
    rows = conn.execute(
        """
        SELECT o.id, p.id, p.status,
               EXISTS (SELECT 1 FROM reservations r
                       WHERE r.order_id = o.id AND r.status = 'active'
                         AND r.expires_at <= coalesce(%(as_of)s, now())) AS hold_expired
        FROM orders o
        JOIN payments p ON p.order_id = o.id AND p.status IN ('pending', 'unknown')
        WHERE o.status = 'pending'
        ORDER BY o.id
        """,
        {"as_of": as_of},
    ).fetchall()
    return [
        ReconcileCandidate(*row) for row in rows if row[2] == "unknown" or row[3]
    ]


def reconcile(
    conn: psycopg.Connection,
    provider: payments.PaymentProvider,
    *,
    as_of: datetime | None = None,
) -> dict[int, ReconcileResult]:
    """Resolve pending orders. Returns what happened to each candidate, by order id.

    Safe to run repeatedly and concurrently with itself and with checkouts:
    every settlement goes through the status-checked UPDATE in record_outcome.
    """
    results: dict[int, ReconcileResult] = {}
    for candidate in reconcile_candidates(conn, as_of=as_of):
        key = payments.idempotency_key(candidate.payment_id)
        try:
            charge = provider.lookup(idempotency_key=key)
        # Deliberately broad, as in pay_order: no answer means no decision.
        except Exception:  # noqa: BLE001
            results[candidate.order_id] = "unchanged"
            continue

        if charge is None and not candidate.hold_expired:
            results[candidate.order_id] = "unchanged"  # still inside the hold
            continue
        if charge is None:
            charge = payments.Charge("failed", None)  # never charged; hold is over

        settled = _settle(conn, candidate.order_id, candidate.payment_id, charge)
        if not settled:
            results[candidate.order_id] = "unchanged"  # someone else settled it
        else:
            results[candidate.order_id] = "paid" if charge.outcome == "succeeded" else "cancelled"
    return results


# --- checkout and reads -------------------------------------------------------------

def checkout(
    conn: psycopg.Connection,
    provider: payments.PaymentProvider,
    *,
    customer_id: int,
    items: Iterable[tuple[int, int]],
    address: DeliveryAddress,
    idempotency_key: str,
) -> CheckoutResult:
    """Place, pay and settle. Safe to call again with the same key, cart and address."""
    order_id, created = place_order(
        conn, customer_id=customer_id, items=items, address=address,
        idempotency_key=idempotency_key,
    )
    pay_order(conn, provider, order_id)  # resumes an interrupted or unknown payment
    return CheckoutResult(get_order(conn, order_id), created)


def guest_checkout(
    conn: psycopg.Connection,
    provider: payments.PaymentProvider,
    *,
    contact: Contact,
    address: DeliveryAddress,
    items: Iterable[tuple[int, int]],
    idempotency_key: str,
) -> CheckoutResult:
    """Checkout without an account: find or create the customer by email, then checkout.

    The order dict has the same shape as get_order_by_token's.

    The customer is committed on its own, before the order: a checkout refused
    for stock still leaves the (harmless) customer row, and a retry finds it.
    """
    customer_id = customers.find_or_create(conn, contact)
    return checkout(
        conn, provider, customer_id=customer_id, items=items, address=address,
        idempotency_key=idempotency_key,
    )


def get_order_by_token(conn: psycopg.Connection, token: str) -> dict:
    """An order by its public token, as the customer sees it. Raises OrderNotFound(token).

    The shape is every OrderOut field, plus the internal `id`.
    """
    row = conn.execute("SELECT id FROM orders WHERE public_token = %s", [token]).fetchone()
    if row is None:
        raise OrderNotFound(token)
    return get_order(conn, row[0])


def get_order(conn: psycopg.Connection, order_id: int) -> dict:
    """An order as the customer sees it: every OrderOut field, plus the internal `id`.

    No unit costs and no customer id. customer_name is the delivery address's
    name, or the customer's for orders placed without an address (seeded ones).
    """
    with conn.cursor(row_factory=dict_row) as cur:
        order = cur.execute(
            "SELECT o.id, o.public_token AS token, o.status, o.total, o.created_at, "
            "       coalesce(a.name, c.name) AS customer_name, "
            "       (SELECT p.status FROM payments p WHERE p.order_id = o.id "
            "        ORDER BY p.id DESC LIMIT 1) AS payment_status "
            "FROM orders o "
            "JOIN customers c ON c.id = o.customer_id "
            "LEFT JOIN order_addresses a ON a.order_id = o.id "
            "WHERE o.id = %s",
            [order_id],
        ).fetchone()
        if order is None:
            raise OrderNotFound(order_id)
        items = cur.execute(
            "SELECT product_id, sku, product_name, quantity, unit_price FROM order_items "
            "WHERE order_id = %s ORDER BY product_id",
            [order_id],
        ).fetchall()
        address = cur.execute(
            "SELECT name, phone, company, vat_number, line1, line2, city, postcode, country "
            "FROM order_addresses WHERE order_id = %s",
            [order_id],
        ).fetchone()

    for item in items:
        item["line_total"] = item["unit_price"] * item["quantity"]
    total = order["total"]
    return {
        "id": order["id"],
        "reference": order_reference(order["id"]),
        "token": order["token"],
        "status": order["status"],
        "payment_status": order["payment_status"],
        "created_at": order["created_at"],
        "customer_name": order["customer_name"],
        "items": items,
        # Delivery is free, so the subtotal is the total; orders.total stays the
        # amount charged, equal to the sum of its items (a tested invariant).
        "subtotal": total,
        "delivery": STANDARD_DELIVERY,
        "total": total,
        "vat_included": vat_included(total),
        "address": address,
    }

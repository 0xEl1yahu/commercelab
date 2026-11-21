"""Payments: the provider adapter, a simulated provider, and the payments table.

THE PROVIDER IS AN ADAPTER
    Checkout talks to any object with a `charge()` method (PaymentProvider).
    The demo uses SimulatedProvider; a real provider later is one new class,
    with no change to orders.py.

IDEMPOTENT CHARGES
    charge() takes an idempotency key. Calling it again with the same key must
    not charge again, and must return the original outcome. Real providers
    (Stripe, Adyen) support exactly this. It is what makes it safe to retry a
    payment whose first attempt timed out: we re-ask instead of guessing.

TRANSPORT FAILURE IS NOT A DECLINE
    A provider that raises (timeout, connection reset) has told us nothing:
    the customer may or may not have been charged. Callers must record that as
    'unknown' and reconcile later, never as 'failed'.

Refunds will live here too; they are not built yet.
"""

import hashlib
import threading
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol

import psycopg

Outcome = Literal["succeeded", "failed"]


@dataclass(frozen=True)
class Charge:
    """A definite answer about a payment.

    reference is the provider's id for the charge. It is None only when we
    settle a payment the provider never received (an abandoned checkout).
    """

    outcome: Outcome
    reference: str | None


class PaymentProvider(Protocol):
    def charge(self, *, idempotency_key: str, amount: Decimal) -> Charge:
        """Charge once per key. Raises on transport failure (outcome unknown)."""
        ...

    def lookup(self, *, idempotency_key: str) -> Charge | None:
        """What happened to this key, WITHOUT charging. None: never charged.

        Reconciliation uses this, never charge(): re-sending charge() for an
        abandoned checkout would bill the customer long after they left.
        Raises on transport failure.
        """
        ...


class SimulatedProvider:
    """Demo provider: no network, no money.

    The outcome is a pure function of the idempotency key, so the same key
    always gets the same answer. About `decline_percent`% of keys decline.

    It remembers which keys it has charged, for lookup(), only in memory. A new
    instance (another process, a restart) has forgotten them; acceptable for a
    demo, and the reason main.py shares one instance across requests.
    """

    def __init__(self, decline_percent: int = 5):
        if not 0 <= decline_percent <= 100:
            raise ValueError("decline_percent must be between 0 and 100")
        self.decline_percent = decline_percent
        self._charged: dict[str, Charge] = {}
        self._lock = threading.Lock()  # requests run in parallel threads

    def charge(self, *, idempotency_key: str, amount: Decimal) -> Charge:
        digest = hashlib.sha256(idempotency_key.encode()).hexdigest()
        declined = int(digest[:8], 16) % 100 < self.decline_percent
        result = Charge("failed" if declined else "succeeded", f"sim_{digest[:16]}")
        with self._lock:
            return self._charged.setdefault(idempotency_key, result)

    def lookup(self, *, idempotency_key: str) -> Charge | None:
        with self._lock:
            return self._charged.get(idempotency_key)


# --- the payments table -------------------------------------------------------------

def create_pending(conn: psycopg.Connection, order_id: int, amount: Decimal) -> int:
    """Record that we intend to charge `amount`. Returns the payment id."""
    return conn.execute(
        "INSERT INTO payments (order_id, amount) VALUES (%s, %s) RETURNING id",
        [order_id, amount],
    ).fetchone()[0]


def open_payment(conn: psycopg.Connection, order_id: int) -> tuple[int, Decimal] | None:
    """The order's unsettled payment (pending or unknown) as (id, amount), if any."""
    return conn.execute(
        "SELECT id, amount FROM payments "
        "WHERE order_id = %s AND status IN ('pending', 'unknown') ORDER BY id DESC LIMIT 1",
        [order_id],
    ).fetchone()


def idempotency_key(payment_id: int) -> str:
    """The provider key for a payment: stable across every retry of that payment."""
    return f"commercelab-payment-{payment_id}"


def mark_unknown(conn: psycopg.Connection, payment_id: int) -> None:
    conn.execute(
        "UPDATE payments SET status = 'unknown', updated_at = now() "
        "WHERE id = %s AND status = 'pending'",
        [payment_id],
    )


def record_outcome(
    conn: psycopg.Connection, payment_id: int, outcome: Outcome, reference: str | None
) -> bool:
    """Settle an unsettled payment. Returns False if it was already settled.

    The status check is inside the UPDATE (the same pattern as inventory.reserve),
    so two concurrent retries can't both settle the same payment.
    """
    settled = conn.execute(
        "UPDATE payments SET status = %s, provider_reference = %s, updated_at = now() "
        "WHERE id = %s AND status IN ('pending', 'unknown') RETURNING id",
        [outcome, reference, payment_id],
    ).fetchone()
    return settled is not None

"""Test doubles and small data builders shared across test modules."""

import threading
from decimal import Decimal

from commercelab.domain import inventory
from commercelab.domain.payments import Charge


class ScriptedProvider:
    """A payment provider whose behaviour each test chooses.

    Like a real provider, it decides each key's outcome once and repeats it on
    every retry. Two ways to fail, matching the two kinds of "unknown":
      down           raises before charging: the customer was NOT charged
      lose_response  charges, then raises: the customer WAS charged, but we
                     never heard (the dangerous case for reconciliation)
    """

    def __init__(self, outcome: str = "succeeded"):
        self.outcome = outcome
        self.down = False
        self.lose_response = False
        self.charged: dict[str, Charge] = {}  # key -> outcome, i.e. real charges
        self.calls = 0
        self.lookups = 0
        self.lock = threading.Lock()
        self.on_charge = None  # optional hook, called with the key

    def charge(self, *, idempotency_key: str, amount: Decimal) -> Charge:
        with self.lock:
            self.calls += 1
            if self.down:
                raise TimeoutError("provider did not respond")
            if self.on_charge:
                self.on_charge(idempotency_key)
            if idempotency_key not in self.charged:
                self.charged[idempotency_key] = Charge(self.outcome, f"ref-{idempotency_key}")
            if self.lose_response:
                raise TimeoutError("charged, but the response was lost")
            return self.charged[idempotency_key]

    def lookup(self, *, idempotency_key: str) -> Charge | None:
        with self.lock:
            self.lookups += 1
            if self.down:
                raise TimeoutError("provider did not respond")
            return self.charged.get(idempotency_key)


def make_shop(conn) -> dict:
    """A customer, a keyboard with 2 in stock and a mouse with 10."""

    def product(sku, name, price, cost, on_hand):
        product_id = conn.execute(
            "INSERT INTO products (sku, name, category, price, unit_cost) "
            "VALUES (%s, %s, 'test', %s, %s) RETURNING id",
            [sku, name, price, cost],
        ).fetchone()[0]
        inventory.restock(conn, product_id, on_hand)
        return product_id

    return {
        "customer": conn.execute(
            "INSERT INTO customers (name, email) VALUES ('Ann', 'ann@example.com') RETURNING id"
        ).fetchone()[0],
        "keyboard": product("KB", "Keyboard", "199.00", "95.00", 2),
        "mouse": product("MS", "Mouse", "25.00", "9.00", 10),
    }

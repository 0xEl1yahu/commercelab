"""Tests for orders.py: checkout end to end, against the Notion invariants (page 4)."""

import dataclasses
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest

from commercelab.data import db
from commercelab.domain import inventory, orders
from commercelab.domain.customers import Contact
from commercelab.domain.inventory import InsufficientStock
from commercelab.domain.orders import (
    CustomerNotFound,
    IdempotencyConflict,
    OrderNotFound,
    ProductUnavailable,
)
from tests.support.fakes import DELIVERY, ScriptedProvider, make_shop
from tests.support.invariants import assert_all_hold as assert_invariants


@pytest.fixture
def shop(conn):
    return make_shop(conn)


def stock(conn, product_id):
    return conn.execute(
        "SELECT on_hand, reserved FROM inventory WHERE product_id = %s", [product_id]
    ).fetchone()


def count(conn, table):
    return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def buy(conn, provider, shop, items, key="key-1", address=DELIVERY):
    return orders.checkout(
        conn, provider, customer_id=shop["customer"], items=items, address=address,
        idempotency_key=key,
    )


# --- the happy path ---------------------------------------------------------------

def test_successful_checkout_pays_the_order_and_sells_the_stock(conn, shop):
    provider = ScriptedProvider("succeeded")
    order, created = buy(conn, provider, shop, [(shop["keyboard"], 1), (shop["mouse"], 2)])

    assert created is True
    assert order["status"] == "paid"
    assert order["payment_status"] == "succeeded"
    assert order["total"] == Decimal("249.00")  # 199 + 2 x 25, from the database
    assert stock(conn, shop["keyboard"]) == (1, 0)
    assert stock(conn, shop["mouse"]) == (8, 0)
    assert len(provider.charged) == 1
    assert_invariants(conn)


def test_order_items_freeze_price_and_cost_at_checkout(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["keyboard"], 1)])
    conn.execute("UPDATE products SET price = 249.00, unit_cost = 120.00 WHERE id = %s",
                 [shop["keyboard"]])

    assert orders.get_order(conn, order["id"])["items"] == [
        {"product_id": shop["keyboard"], "sku": "KB", "product_name": "Keyboard",
         "quantity": 1, "unit_price": Decimal("199.00"), "line_total": Decimal("199.00")}
    ]
    cost = conn.execute("SELECT unit_cost FROM order_items WHERE order_id = %s",
                        [order["id"]]).fetchone()[0]
    assert cost == Decimal("95.00")


def test_customer_facing_order_has_no_unit_cost(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1)])
    assert all(
        set(item) == {"product_id", "sku", "product_name", "quantity", "unit_price", "line_total"}
        for item in order["items"]
    )
    assert "unit_cost" not in order


def test_order_items_keep_name_and_sku_after_a_rename(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["keyboard"], 1)])
    conn.execute("UPDATE products SET name = 'Keyboard Mk II', sku = 'KB-2' WHERE id = %s",
                 [shop["keyboard"]])

    [item] = orders.get_order(conn, order["id"])["items"]
    assert (item["product_name"], item["sku"]) == ("Keyboard", "KB")


def test_order_totals_include_vat_and_free_delivery(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["keyboard"], 1), (shop["mouse"], 2)])

    assert [item["line_total"] for item in order["items"]] == [Decimal("199.00"), Decimal("50.00")]
    assert order["subtotal"] == Decimal("249.00")
    assert order["delivery"] == Decimal("0.00")
    assert order["total"] == Decimal("249.00")
    assert order["vat_included"] == Decimal("41.50")  # 249.00 / 6


# --- the delivery address, the reference and the token ----------------------------

def test_order_keeps_the_delivery_address(conn, shop):
    address = dataclasses.replace(DELIVERY, line2="Flat 2", company="Northfold Ltd")
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1)], address=address)

    assert order["address"] == {
        "name": "Ann Lee", "phone": "07700 900000", "company": "Northfold Ltd",
        "vat_number": None, "line1": "1 Test Street", "line2": "Flat 2", "city": "Leeds",
        "postcode": "LS1 1AA", "country": "GB",
    }
    # The recipient's name, not the customer record's ('Ann').
    assert order["customer_name"] == "Ann Lee"
    assert count(conn, "order_addresses") == 1
    assert_invariants(conn)


def test_order_reference_format():
    assert orders.order_reference(7) == "CL-00007"
    assert orders.order_reference(1501) == "CL-01501"


def test_order_carries_its_reference_and_a_token(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1)])
    assert order["reference"] == orders.order_reference(order["id"])
    assert len(order["token"]) == 32 and int(order["token"], 16) >= 0


def test_get_order_by_token(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1)])
    assert orders.get_order_by_token(conn, order["token"]) == order


def test_unknown_token_raises(conn, shop):
    buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1)])
    with pytest.raises(OrderNotFound) as raised:
        orders.get_order_by_token(conn, "0" * 32)
    assert raised.value.ref == "0" * 32


def test_guest_checkout_uses_the_customer_with_that_email_and_is_retry_safe(conn, shop):
    contact = Contact(email="ANN@Example.com", name="Ann Lee", phone="07700 900000")
    provider = ScriptedProvider()

    def guest_buy():
        return orders.guest_checkout(conn, provider, contact=contact, address=DELIVERY,
                                     items=[(shop["mouse"], 1)], idempotency_key="guest-1")

    first, again = guest_buy(), guest_buy()
    assert (first.created, again.created) == (True, False)
    assert again.order == first.order
    assert first.order["status"] == "paid"
    assert len(provider.charged) == 1
    owner = conn.execute("SELECT customer_id FROM orders WHERE id = %s",
                         [first.order["id"]]).fetchone()[0]
    assert owner == shop["customer"]  # make_shop's ann@example.com, not a new customer
    assert count(conn, "customers") == 1
    assert_invariants(conn)


def test_seeded_order_without_address_reads_back_with_none(conn, seeded):
    order_id, customer_name = conn.execute(
        "SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id "
        "ORDER BY o.id LIMIT 1"
    ).fetchone()
    order = orders.get_order(conn, order_id)

    assert order["address"] is None
    assert order["customer_name"] == customer_name
    assert orders.get_order_by_token(conn, order["token"]) == order


# --- payment outcomes -------------------------------------------------------------

def test_declined_payment_cancels_the_order_and_releases_the_stock(conn, shop):
    order, _ = buy(conn, ScriptedProvider("failed"), shop, [(shop["keyboard"], 2)])

    assert order["status"] == "cancelled"
    assert order["payment_status"] == "failed"
    assert stock(conn, shop["keyboard"]) == (2, 0)  # released, nothing sold
    assert_invariants(conn)


def test_provider_timeout_leaves_the_order_pending_and_the_stock_held(conn, shop):
    """Notion invariant: payment result unknown -> remains reconcilable, not 'failed'."""
    provider = ScriptedProvider()
    provider.down = True
    order, _ = buy(conn, provider, shop, [(shop["keyboard"], 2)])

    assert order["status"] == "pending"
    assert order["payment_status"] == "unknown"
    assert stock(conn, shop["keyboard"]) == (2, 2)  # still held: may have been charged
    assert_invariants(conn)


def test_retry_after_a_timeout_completes_the_order_with_one_charge(conn, shop):
    provider = ScriptedProvider()
    provider.down = True
    first, _ = buy(conn, provider, shop, [(shop["keyboard"], 2)])
    provider.down = False
    second, created = buy(conn, provider, shop, [(shop["keyboard"], 2)])

    assert created is False
    assert second["id"] == first["id"]
    assert second["status"] == "paid"
    assert len(provider.charged) == 1      # one real charge across both attempts
    assert count(conn, "payments") == 1
    assert stock(conn, shop["keyboard"]) == (0, 0)
    assert_invariants(conn)


def test_crash_between_placing_and_paying_is_resumed_by_a_retry(conn, shop):
    """Simulate the process dying after step 1: only place_order ran."""
    order_id, created = orders.place_order(
        conn, customer_id=shop["customer"], items=[(shop["mouse"], 1)], address=DELIVERY,
        idempotency_key="key-1")
    assert created is True
    assert orders.get_order(conn, order_id)["status"] == "pending"

    provider = ScriptedProvider()
    order, created = buy(conn, provider, shop, [(shop["mouse"], 1)])
    assert (order["id"], order["status"], created) == (order_id, "paid", False)
    assert len(provider.charged) == 1
    assert_invariants(conn)


# --- idempotency ------------------------------------------------------------------

def test_retrying_a_completed_checkout_returns_it_without_charging_again(conn, shop):
    provider = ScriptedProvider()
    first, _ = buy(conn, provider, shop, [(shop["mouse"], 1)])
    calls_after_first = provider.calls

    again, created = buy(conn, provider, shop, [(shop["mouse"], 1)])
    assert created is False
    assert again == first
    assert provider.calls == calls_after_first  # settled orders aren't re-charged
    assert count(conn, "orders") == 1


def test_retry_with_lines_in_a_different_order_is_the_same_request(conn, shop):
    provider = ScriptedProvider()
    first, _ = buy(conn, provider, shop, [(shop["keyboard"], 1), (shop["mouse"], 1)])
    again, created = buy(conn, provider, shop, [(shop["mouse"], 1), (shop["keyboard"], 1)])
    assert (again["id"], created) == (first["id"], False)


def test_same_key_with_a_different_cart_is_refused(conn, shop):
    provider = ScriptedProvider()
    buy(conn, provider, shop, [(shop["mouse"], 1)])
    before = (count(conn, "orders"), stock(conn, shop["mouse"]))

    with pytest.raises(IdempotencyConflict):
        buy(conn, provider, shop, [(shop["mouse"], 5)])
    assert (count(conn, "orders"), stock(conn, shop["mouse"])) == before


def test_retry_after_product_discontinued_returns_the_original_order(conn, shop):
    """The fast path runs before validation: a retry gets its order back even if
    the product has since stopped being sold."""
    provider = ScriptedProvider()
    first, _ = buy(conn, provider, shop, [(shop["mouse"], 1)])
    conn.execute("UPDATE products SET active = false WHERE id = %s", [shop["mouse"]])

    again, created = buy(conn, provider, shop, [(shop["mouse"], 1)])
    assert created is False
    assert again == first
    assert count(conn, "orders") == 1
    assert len(provider.charged) == 1
    assert_invariants(conn)


def test_same_key_different_address_is_a_conflict(conn, shop):
    provider = ScriptedProvider()
    first, _ = buy(conn, provider, shop, [(shop["mouse"], 1)])
    calls_after_first = provider.calls

    moved = dataclasses.replace(DELIVERY, line1="2 Other Street")
    with pytest.raises(IdempotencyConflict):
        buy(conn, provider, shop, [(shop["mouse"], 1)], address=moved)
    assert count(conn, "orders") == 1
    assert orders.get_order(conn, first["id"])["address"]["line1"] == "1 Test Street"
    assert provider.calls == calls_after_first


# --- refusals: nothing is created ------------------------------------------------------

def test_three_keyboards_when_two_remain_creates_nothing_and_charges_nothing(conn, shop):
    provider = ScriptedProvider()
    with pytest.raises(InsufficientStock) as raised:
        buy(conn, provider, shop, [(shop["keyboard"], 3)])

    assert (raised.value.requested, raised.value.available) == (3, 2)
    assert stock(conn, shop["keyboard"]) == (2, 0)
    assert [count(conn, t) for t in ("orders", "order_items", "reservations", "payments")] \
        == [0, 0, 0, 0]
    assert provider.calls == 0
    assert_invariants(conn)


def test_a_short_line_undoes_every_other_line(conn, shop):
    with pytest.raises(InsufficientStock):
        buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 2), (shop["keyboard"], 3)])
    assert stock(conn, shop["mouse"]) == (10, 0)
    assert count(conn, "orders") == 0


def test_a_refused_checkout_leaves_the_key_free_to_retry(conn, shop):
    with pytest.raises(InsufficientStock):
        buy(conn, ScriptedProvider(), shop, [(shop["keyboard"], 3)], key="key-1")
    inventory.restock(conn, shop["keyboard"], 1)
    order, created = buy(conn, ScriptedProvider(), shop, [(shop["keyboard"], 3)], key="key-1")
    assert (order["status"], created) == ("paid", True)


def test_inactive_and_missing_products_are_unavailable(conn, shop):
    conn.execute("UPDATE products SET active = false WHERE id = %s", [shop["mouse"]])
    missing = shop["mouse"] + 1000
    with pytest.raises(ProductUnavailable) as raised:
        buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1), (missing, 1)])
    assert sorted(raised.value.product_ids) == sorted([shop["mouse"], missing])
    assert count(conn, "orders") == 0


def test_unknown_customer_is_refused(conn, shop):
    with pytest.raises(CustomerNotFound):
        orders.checkout(conn, ScriptedProvider(), customer_id=shop["customer"] + 1000,
                        items=[(shop["mouse"], 1)], address=DELIVERY, idempotency_key="key-1")


# --- request normalisation ------------------------------------------------------------

def test_repeated_products_are_merged_into_one_line(conn, shop):
    order, _ = buy(conn, ScriptedProvider(), shop, [(shop["mouse"], 1), (shop["mouse"], 2)])
    assert [(i["product_id"], i["quantity"]) for i in order["items"]] == [(shop["mouse"], 3)]


@pytest.mark.parametrize("items", [[], [(1, 0)], [(1, -2)]], ids=["empty", "zero", "negative"])
def test_invalid_carts_are_rejected(items):
    with pytest.raises(ValueError):
        orders.normalise_items(items)


def test_get_order_of_a_missing_order_raises(conn):
    with pytest.raises(OrderNotFound):
        orders.get_order(conn, 999_999)


# --- real transactions and concurrency --------------------------------------------------

def committed_shop(url):
    with db.connect(url) as conn, conn.transaction():
        return make_shop(conn)


def guest_buy(conn, provider, shop, items, key="key-1"):
    """buy(), through the guest path: find the customer by email, then checkout."""
    contact = Contact(email="ann@example.com", name="Ann Lee", phone="07700 900000")
    return orders.guest_checkout(conn, provider, contact=contact, address=DELIVERY,
                                 items=items, idempotency_key=key)


@pytest.mark.parametrize("place", [buy, guest_buy], ids=["checkout", "guest_checkout"])
def test_payment_is_requested_only_after_the_reservation_is_committed(committed_db, place):
    """Notion: don't hold the DB transaction open through a remote payment call.

    Both entry points: guest_checkout must not wrap find_or_create and checkout
    in one transaction, or the charge would happen inside it.
    """
    shop = committed_shop(committed_db)
    seen_by_another_connection = {}

    def look_from_outside(key):
        with db.connect(committed_db) as observer:
            seen_by_another_connection["orders"] = count(observer, "orders")
            seen_by_another_connection["customers"] = count(observer, "customers")
            seen_by_another_connection["stock"] = stock(observer, shop["keyboard"])

    provider = ScriptedProvider()
    provider.on_charge = look_from_outside
    with db.connect(committed_db) as conn:
        assert conn.info.transaction_status.name == "IDLE"
        result = place(conn, provider, shop, [(shop["keyboard"], 2)])
        assert result.order["status"] == "paid"

    # At charge time, the order and its reservation were already committed.
    assert seen_by_another_connection == {"orders": 1, "customers": 1, "stock": (2, 2)}


@pytest.mark.concurrency
def test_simultaneous_retries_of_one_checkout_create_one_order_and_one_charge(committed_db):
    shop = committed_shop(committed_db)
    provider = ScriptedProvider()
    attempts = 6
    start_together = threading.Barrier(attempts)

    def attempt(_):
        with db.connect(committed_db) as conn:
            start_together.wait()
            return buy(conn, provider, shop, [(shop["keyboard"], 2)], key="double-click")

    with ThreadPoolExecutor(max_workers=attempts) as pool:
        results = list(pool.map(attempt, range(attempts)))

    assert len({r.order["id"] for r in results}) == 1      # everyone got the same order
    assert sum(r.created for r in results) == 1             # exactly one created it
    assert len(provider.charged) == 1                       # and it was charged once
    with db.connect(committed_db) as conn:
        assert count(conn, "orders") == 1
        assert count(conn, "payments") == 1
        assert stock(conn, shop["keyboard"]) == (0, 0)
        assert_invariants(conn)


@pytest.mark.concurrency
def test_two_customers_race_for_the_last_two_keyboards(committed_db):
    shop = committed_shop(committed_db)
    provider = ScriptedProvider()
    start_together = threading.Barrier(2)

    def attempt(key):
        with db.connect(committed_db) as conn:
            start_together.wait()
            try:
                return buy(conn, provider, shop, [(shop["keyboard"], 2)], key=key).order["status"]
            except InsufficientStock:
                return "refused"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = sorted(pool.map(attempt, ["alice", "bob"]))

    assert results == ["paid", "refused"]
    with db.connect(committed_db) as conn:
        assert stock(conn, shop["keyboard"]) == (0, 0)
        assert_invariants(conn)

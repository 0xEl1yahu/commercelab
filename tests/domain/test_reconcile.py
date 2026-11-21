"""Tests for reservation expiry and orders.reconcile: pending orders get resolved
without ever releasing stock a customer may have paid for.

Time: inside the `conn` fixture's transaction, Postgres's now() is fixed (it is
the transaction's start time). Tests move the clock by passing `as_of`, so
nothing waits for real minutes to pass.
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from commercelab.config import settings
from commercelab.data import db
from commercelab.domain import inventory, orders, payments
from scripts import reconcile as reconcile_script
from tests.support.fakes import ScriptedProvider, make_shop
from tests.support.invariants import assert_all_hold as assert_invariants

HOLD = timedelta(minutes=settings.reservation_hold_minutes)


def db_now(conn):
    return conn.execute("SELECT now()").fetchone()[0]


def order_state(conn, order_id):
    """(order status, payment status, reservation statuses)."""
    order = orders.get_order(conn, order_id)
    reservations = sorted(row[0] for row in conn.execute(
        "SELECT status FROM reservations WHERE order_id = %s", [order_id]))
    return order["status"], order["payment_status"], reservations


def stock(conn, product_id):
    return conn.execute(
        "SELECT on_hand, reserved FROM inventory WHERE product_id = %s", [product_id]
    ).fetchone()


@pytest.fixture
def shop(conn):
    return make_shop(conn)


def abandoned_checkout(conn, shop, quantity=1, key="abandoned"):
    """Step 1 only: as if the process died before calling the provider."""
    order_id, _ = orders.place_order(
        conn, customer_id=shop["customer"], items=[(shop["keyboard"], quantity)],
        idempotency_key=key)
    return order_id


def timed_out_checkout(conn, shop, provider, quantity=1, key="timed-out"):
    result = orders.checkout(
        conn, provider, customer_id=shop["customer"],
        items=[(shop["keyboard"], quantity)], idempotency_key=key)
    assert result.order["payment_status"] == "unknown"
    return result.order["id"]


# --- expiry is set at checkout --------------------------------------------------------

def test_checkout_holds_stock_for_the_configured_time(conn, shop):
    order_id = abandoned_checkout(conn, shop)
    expires_at = conn.execute(
        "SELECT expires_at FROM reservations WHERE order_id = %s", [order_id]).fetchone()[0]
    assert expires_at == db_now(conn) + HOLD


def test_hold_length_comes_from_settings(conn, shop, monkeypatch):
    monkeypatch.setattr(settings, "reservation_hold_minutes", 2)
    order_id = abandoned_checkout(conn, shop)
    expires_at = conn.execute(
        "SELECT expires_at FROM reservations WHERE order_id = %s", [order_id]).fetchone()[0]
    assert expires_at == db_now(conn) + timedelta(minutes=2)


def test_reserve_without_a_hold_never_expires(conn, shop):
    order_id = abandoned_checkout(conn, shop)
    reservation_id = inventory.reserve(conn, order_id, shop["mouse"], 1)
    expires_at = conn.execute(
        "SELECT expires_at FROM reservations WHERE id = %s", [reservation_id]).fetchone()[0]
    assert expires_at is None


# --- what gets reconciled ------------------------------------------------------------

def test_an_abandoned_checkout_inside_its_hold_is_left_alone(conn, shop):
    order_id = abandoned_checkout(conn, shop)
    assert orders.reconcile(conn, ScriptedProvider(), as_of=db_now(conn)) == {}
    assert order_state(conn, order_id) == ("pending", "pending", ["active"])


def test_an_abandoned_checkout_is_cancelled_once_its_hold_expires(conn, shop):
    order_id = abandoned_checkout(conn, shop, quantity=2)
    provider = ScriptedProvider()

    results = orders.reconcile(conn, provider, as_of=db_now(conn) + HOLD)

    assert results == {order_id: "cancelled"}
    assert order_state(conn, order_id) == ("cancelled", "failed", ["released"])
    assert stock(conn, shop["keyboard"]) == (2, 0)  # back on sale
    assert provider.calls == 0                       # asked, never charged
    assert provider.lookups == 1
    assert_invariants(conn)


def test_a_lost_response_for_a_successful_charge_becomes_a_paid_order(conn, shop):
    """The customer WAS charged; we just never heard. They must get their order."""
    provider = ScriptedProvider()
    provider.lose_response = True
    order_id = timed_out_checkout(conn, shop, provider, quantity=2)

    results = orders.reconcile(conn, provider, as_of=db_now(conn) + HOLD)

    assert results == {order_id: "paid"}  # even though the hold had expired
    assert order_state(conn, order_id) == ("paid", "succeeded", ["committed"])
    assert stock(conn, shop["keyboard"]) == (0, 0)  # sold, not released
    assert len(provider.charged) == 1
    assert_invariants(conn)


def test_a_lost_response_for_a_declined_charge_cancels_the_order(conn, shop):
    provider = ScriptedProvider("failed")
    provider.lose_response = True
    order_id = timed_out_checkout(conn, shop, provider)

    assert orders.reconcile(conn, provider, as_of=db_now(conn)) == {order_id: "cancelled"}
    assert stock(conn, shop["keyboard"]) == (2, 0)


def test_unknown_payment_is_settled_before_its_hold_expires(conn, shop):
    """No need to wait for expiry when the provider can already answer."""
    provider = ScriptedProvider()
    provider.lose_response = True
    order_id = timed_out_checkout(conn, shop, provider)
    assert orders.reconcile(conn, provider, as_of=db_now(conn)) == {order_id: "paid"}


def test_unknown_payment_the_provider_never_saw_waits_for_the_hold(conn, shop):
    provider = ScriptedProvider()
    provider.down = True
    order_id = timed_out_checkout(conn, shop, provider)
    provider.down = False

    assert orders.reconcile(conn, provider, as_of=db_now(conn)) == {order_id: "unchanged"}
    assert orders.reconcile(conn, provider, as_of=db_now(conn) + HOLD) == {order_id: "cancelled"}


def test_an_unreachable_provider_never_releases_stock(conn, shop):
    """Decision: releasing stock the customer may have paid for is worse than waiting."""
    provider = ScriptedProvider()
    provider.lose_response = True
    order_id = timed_out_checkout(conn, shop, provider, quantity=2)
    provider.lose_response = False
    provider.down = True

    results = orders.reconcile(conn, provider, as_of=db_now(conn) + 10 * HOLD)

    assert results == {order_id: "unchanged"}
    assert order_state(conn, order_id) == ("pending", "unknown", ["active"])
    assert stock(conn, shop["keyboard"]) == (2, 2)  # still held
    assert_invariants(conn)


def test_settled_orders_and_unexpiring_holds_are_not_candidates(conn, seeded):
    """Seeded data: settled orders, and pending orders whose holds never expire."""
    far_future = db_now(conn) + timedelta(days=365)
    candidates = orders.reconcile_candidates(conn, as_of=far_future)
    assert {c.payment_status for c in candidates} <= {"unknown"}  # never 'pending'


def test_reconcile_is_idempotent(conn, shop):
    order_id = abandoned_checkout(conn, shop)
    later = db_now(conn) + HOLD
    assert orders.reconcile(conn, ScriptedProvider(), as_of=later) == {order_id: "cancelled"}
    assert orders.reconcile(conn, ScriptedProvider(), as_of=later) == {}


def test_a_customer_retry_after_cancellation_gets_the_cancelled_order(conn, shop):
    order_id = abandoned_checkout(conn, shop, key="abandoned")
    orders.reconcile(conn, ScriptedProvider(), as_of=db_now(conn) + HOLD)

    provider = ScriptedProvider()
    result = orders.checkout(conn, provider, customer_id=shop["customer"],
                             items=[(shop["keyboard"], 1)], idempotency_key="abandoned")
    assert (result.order["id"], result.order["status"]) == (order_id, "cancelled")
    assert provider.calls == 0  # a cancelled order is never charged


# --- concurrency -------------------------------------------------------------------------

@pytest.mark.concurrency
def test_two_reconcilers_at_once_settle_each_order_once(committed_db):
    with db.connect(committed_db) as conn, conn.transaction():
        shop = make_shop(conn)
        order_ids = [abandoned_checkout(conn, shop, key=f"k{i}") for i in range(2)]
    with db.connect(committed_db) as conn:
        later = db_now(conn) + HOLD

    start_together = threading.Barrier(2)

    def run_reconciler(_):
        with db.connect(committed_db) as conn:
            start_together.wait()
            return orders.reconcile(conn, ScriptedProvider(), as_of=later)

    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(run_reconciler, range(2)))

    for order_id in order_ids:
        outcomes = sorted(run.get(order_id, "unchanged") for run in runs)
        assert outcomes == ["cancelled", "unchanged"]  # one run did it, never both
    with db.connect(committed_db) as conn:
        assert stock(conn, shop["keyboard"]) == (2, 0)
        assert_invariants(conn)


# --- the script ---------------------------------------------------------------------------

def test_script_dry_run_lists_candidates_and_changes_nothing(committed_db, monkeypatch, capsys):
    monkeypatch.setattr(settings, "database_url", committed_db)
    with db.connect(committed_db) as conn, conn.transaction():
        shop = make_shop(conn)
        order_id = abandoned_checkout(conn, shop)
        conn.execute("UPDATE reservations SET expires_at = now() - interval '1 second'")

    reconcile_script.main(["--dry-run"])
    output = capsys.readouterr().out
    assert f"order {order_id}" in output and "hold expired" in output
    with db.connect(committed_db) as conn:
        assert order_state(conn, order_id)[0] == "pending"


def test_script_cancels_expired_abandoned_checkouts(committed_db, monkeypatch, capsys):
    monkeypatch.setattr(settings, "database_url", committed_db)
    with db.connect(committed_db) as conn, conn.transaction():
        shop = make_shop(conn)
        order_id = abandoned_checkout(conn, shop)
        conn.execute("UPDATE reservations SET expires_at = now() - interval '1 second'")

    reconcile_script.main([])
    assert "1 cancelled" in capsys.readouterr().out
    with db.connect(committed_db) as conn:
        assert order_state(conn, order_id) == ("cancelled", "failed", ["released"])
        assert_invariants(conn)


def test_script_refuses_to_run_in_live(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "live")
    monkeypatch.setattr(reconcile_script.db, "connect", lambda *a, **k: pytest.fail("connected"))
    with pytest.raises(SystemExit, match="no live payment provider"):
        reconcile_script.main([])


# --- the simulated provider -------------------------------------------------------------

def test_simulated_provider_lookup_reports_only_what_it_charged():
    provider = payments.SimulatedProvider(decline_percent=0)
    assert provider.lookup(idempotency_key="k") is None
    charged = provider.charge(idempotency_key="k", amount=1)
    assert provider.lookup(idempotency_key="k") == charged
    assert provider.charge(idempotency_key="k", amount=1) == charged  # same answer again


def test_the_api_shares_one_provider_so_lookups_see_earlier_charges():
    from commercelab.api.dependencies import get_payment_provider

    assert get_payment_provider() is get_payment_provider()

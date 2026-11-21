"""Tests for inventory.py: stock can never be oversold, and every change is audited.

Two kinds of test:
  - single-connection tests (`conn`): the rules, inside a rolled-back transaction
  - concurrency tests (`committed_db`): two or more real connections racing for
    the same stock. Only real commits on separate connections can show a race,
    so these can't use the rolled-back `conn`.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from commercelab.data import db
from commercelab.domain import inventory
from commercelab.domain.inventory import InsufficientStock, ReservationNotActive
from tests.support.invariants import STOCK_INVARIANTS, violations

NO_STOCK_VIOLATIONS = {name: 0 for name in STOCK_INVARIANTS}


def make_stock(conn, on_hand: int, n_orders: int = 1) -> tuple[int, list[int]]:
    """One product with `on_hand` units (added via inventory.restock, so the
    movement ledger is consistent), plus `n_orders` pending orders to reserve for."""
    product_id = conn.execute(
        "INSERT INTO products (sku, name, category, price, unit_cost) "
        "VALUES ('KB', 'Keyboard', 'keyboards', 199.00, 95.00) RETURNING id"
    ).fetchone()[0]
    inventory.restock(conn, product_id, on_hand)
    customer_id = conn.execute(
        "INSERT INTO customers (name, email) VALUES ('Ann', 'ann@example.com') RETURNING id"
    ).fetchone()[0]
    order_ids = [
        conn.execute(
            "INSERT INTO orders (customer_id, total, idempotency_key, request_hash) "
            "VALUES (%s, 0, %s, 'h') RETURNING id",
            [customer_id, f"test-order-{i}"],
        ).fetchone()[0]
        for i in range(n_orders)
    ]
    return product_id, order_ids


def stock(conn, product_id: int) -> tuple[int, int, int]:
    """(on_hand, reserved, available) for one product."""
    return conn.execute(
        "SELECT on_hand, reserved, available FROM product_availability WHERE product_id = %s",
        [product_id],
    ).fetchone()


def count(conn, table: str) -> int:
    return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


# --- reserve --------------------------------------------------------------------

def test_reserve_holds_stock_without_removing_it(conn):
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    reservation_id = inventory.reserve(conn, order_id, product_id, 2)

    assert stock(conn, product_id) == (5, 2, 3)  # on_hand unchanged; 2 held
    status = conn.execute(
        "SELECT status FROM reservations WHERE id = %s", [reservation_id]).fetchone()[0]
    assert status == "active"
    assert count(conn, "stock_movements") == 1  # only the restock: holding isn't moving
    assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


def test_reserve_can_take_every_available_unit(conn):
    product_id, (order_id,) = make_stock(conn, on_hand=2)
    inventory.reserve(conn, order_id, product_id, 2)
    assert stock(conn, product_id) == (2, 2, 0)


def test_three_keyboards_when_two_remain_is_rejected_and_changes_nothing(conn):
    """The design exercise from the Notion plan, page 5."""
    product_id, (order_id,) = make_stock(conn, on_hand=2)
    reservations_before = count(conn, "reservations")

    with pytest.raises(InsufficientStock) as raised:
        inventory.reserve(conn, order_id, product_id, 3)

    assert (raised.value.requested, raised.value.available) == (3, 2)
    assert stock(conn, product_id) == (2, 0, 2)                 # nothing deducted
    assert count(conn, "reservations") == reservations_before   # nothing recorded
    assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


def test_reserve_counts_units_already_reserved_by_other_orders(conn):
    product_id, (first, second) = make_stock(conn, on_hand=2, n_orders=2)
    inventory.reserve(conn, first, product_id, 1)
    with pytest.raises(InsufficientStock) as raised:
        inventory.reserve(conn, second, product_id, 2)  # on_hand is 2, but only 1 is free
    assert raised.value.available == 1


def test_reserving_a_product_with_no_inventory_row_is_insufficient_stock(conn):
    product_id, (order_id,) = make_stock(conn, on_hand=1)
    conn.execute("DELETE FROM stock_movements WHERE product_id = %s", [product_id])
    conn.execute("DELETE FROM inventory WHERE product_id = %s", [product_id])
    with pytest.raises(InsufficientStock) as raised:
        inventory.reserve(conn, order_id, product_id, 1)
    assert raised.value.available == 0


@pytest.mark.parametrize("quantity", [0, -1])
def test_reserve_rejects_non_positive_quantities(conn, quantity):
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    with pytest.raises(ValueError):
        inventory.reserve(conn, order_id, product_id, quantity)


def test_failure_on_a_later_line_undoes_earlier_lines(conn):
    """How orders.py will use reserve(): every line of a checkout in one block."""
    product_id, (order_id,) = make_stock(conn, on_hand=2)
    other_id, _ = make_stock_for_second_product(conn, on_hand=0)

    with pytest.raises(InsufficientStock), conn.transaction():
        inventory.reserve(conn, order_id, product_id, 2)  # succeeds...
        inventory.reserve(conn, order_id, other_id, 1)    # ...then this line fails

    assert stock(conn, product_id) == (2, 0, 2)  # the first line was rolled back too
    assert count(conn, "reservations") == 0


def make_stock_for_second_product(conn, on_hand: int) -> tuple[int, None]:
    product_id = conn.execute(
        "INSERT INTO products (sku, name, category, price, unit_cost) "
        "VALUES ('MS', 'Mouse', 'mice', 25.00, 9.00) RETURNING id"
    ).fetchone()[0]
    if on_hand:
        inventory.restock(conn, product_id, on_hand)
    else:
        conn.execute("INSERT INTO inventory (product_id) VALUES (%s)", [product_id])
    return product_id, None


# --- release and convert_to_sale --------------------------------------------------

def test_release_returns_the_units(conn):
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    reservation_id = inventory.reserve(conn, order_id, product_id, 2)
    inventory.release(conn, reservation_id)

    assert stock(conn, product_id) == (5, 0, 5)
    assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


def test_releasing_twice_fails_and_does_not_double_count(conn):
    """Notion invariant: a failed payment releases its reservation exactly once."""
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    reservation_id = inventory.reserve(conn, order_id, product_id, 2)
    inventory.release(conn, reservation_id)

    with pytest.raises(ReservationNotActive):
        inventory.release(conn, reservation_id)
    assert stock(conn, product_id) == (5, 0, 5)  # not (5, -2, 7)


def test_convert_to_sale_removes_the_units_and_records_the_sale(conn):
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    reservation_id = inventory.reserve(conn, order_id, product_id, 2)
    inventory.convert_to_sale(conn, reservation_id)

    assert stock(conn, product_id) == (3, 0, 3)
    movement = conn.execute(
        "SELECT quantity_delta, reason, order_id FROM stock_movements "
        "WHERE product_id = %s ORDER BY id DESC LIMIT 1", [product_id]).fetchone()
    assert movement == (-2, "sale", order_id)
    assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


@pytest.mark.parametrize(
    ("first", "second"),
    [("convert_to_sale", "convert_to_sale"), ("convert_to_sale", "release"),
     ("release", "convert_to_sale")],
)
def test_a_reservation_is_settled_exactly_once(conn, first, second):
    product_id, (order_id,) = make_stock(conn, on_hand=5)
    reservation_id = inventory.reserve(conn, order_id, product_id, 2)
    getattr(inventory, first)(conn, reservation_id)
    after_first = stock(conn, product_id)

    with pytest.raises(ReservationNotActive):
        getattr(inventory, second)(conn, reservation_id)
    assert stock(conn, product_id) == after_first


def test_unknown_reservation_is_not_active(conn):
    with pytest.raises(ReservationNotActive):
        inventory.release(conn, 999_999)


# --- restock ----------------------------------------------------------------------

def test_restock_adds_units_and_records_the_movement(conn):
    product_id, _ = make_stock(conn, on_hand=2)
    inventory.restock(conn, product_id, 10)
    assert stock(conn, product_id) == (12, 0, 12)
    assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


@pytest.mark.parametrize("quantity", [0, -5])
def test_restock_rejects_non_positive_quantities(conn, quantity):
    product_id, _ = make_stock(conn, on_hand=2)
    with pytest.raises(ValueError):
        inventory.restock(conn, product_id, quantity)


# --- concurrency: real connections racing for the same row -------------------------

def wait_until_blocked_on_a_lock(observer, backend_pid: int, worker: threading.Thread):
    """Wait until the worker's connection is waiting on a row lock.

    Fails if the worker finishes first: then the two connections never
    actually overlapped, and the test would prove nothing.
    """
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        waiting_on = observer.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [backend_pid]
        ).fetchone()[0]
        if waiting_on == "Lock":
            return
        if not worker.is_alive():
            pytest.fail("the second connection never waited for the lock: no race happened")
        time.sleep(0.01)
    pytest.fail("timed out waiting for the second connection to block")


def race(url: str, holder, contender):
    """Force the worst-case interleaving between two connections.

    `holder` runs in an open transaction. `contender` then starts on a second
    connection in another thread and is allowed to get as far as it can, which
    must be blocked on the holder's lock. Only then does the holder commit.
    Returns what the contender returned or raised.
    """
    outcome = {}
    with db.connect(url) as holder_conn, db.connect(url) as contender_conn, \
            db.connect(url) as observer:

        def run_contender():
            try:
                with contender_conn.transaction():
                    outcome["result"] = contender(contender_conn)
            # Deliberately broad: an exception in a thread would otherwise vanish.
            # Whatever it is, it's handed back to the test to assert on.
            except Exception as error:  # noqa: BLE001
                outcome["error"] = error

        with holder_conn.transaction():
            holder(holder_conn)
            worker = threading.Thread(target=run_contender)
            worker.start()
            wait_until_blocked_on_a_lock(observer, contender_conn.info.backend_pid, worker)
        # leaving the block committed the holder; the contender now proceeds
        worker.join(timeout=10)
    return outcome


def committed_stock(url: str, on_hand: int, n_orders: int):
    with db.connect(url) as conn, conn.transaction():
        return make_stock(conn, on_hand, n_orders)


@pytest.mark.concurrency
def test_two_checkouts_race_for_the_last_two_keyboards(committed_db):
    """Both see 2 available; exactly one may have them."""
    product_id, (order_a, order_b) = committed_stock(committed_db, on_hand=2, n_orders=2)

    outcome = race(
        committed_db,
        holder=lambda conn: inventory.reserve(conn, order_a, product_id, 2),
        contender=lambda conn: inventory.reserve(conn, order_b, product_id, 2),
    )

    error = outcome.get("error")
    assert isinstance(error, InsufficientStock), (
        f"second checkout should be refused cleanly, got {error!r}")
    assert error.available == 0
    with db.connect(committed_db) as conn:
        assert stock(conn, product_id) == (2, 2, 0)   # reserved exactly once
        assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


@pytest.mark.concurrency
def test_payment_success_and_release_race_settles_once(committed_db):
    """A payment confirmation and a timeout release arrive together: one wins."""
    product_id, (order_id,) = committed_stock(committed_db, on_hand=5, n_orders=1)
    with db.connect(committed_db) as conn, conn.transaction():
        reservation_id = inventory.reserve(conn, order_id, product_id, 2)

    outcome = race(
        committed_db,
        holder=lambda conn: inventory.convert_to_sale(conn, reservation_id),
        contender=lambda conn: inventory.release(conn, reservation_id),
    )

    assert isinstance(outcome.get("error"), ReservationNotActive), outcome
    with db.connect(committed_db) as conn:
        assert stock(conn, product_id) == (3, 0, 3)   # sold once, never also released
        assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS


@pytest.mark.concurrency
def test_many_simultaneous_checkouts_never_oversell(committed_db):
    """No forced ordering: 10 threads released at once, competing for 5 units."""
    buyers, units = 10, 5
    product_id, order_ids = committed_stock(committed_db, on_hand=units, n_orders=buyers)
    start_together = threading.Barrier(buyers)

    def checkout(order_id):
        with db.connect(committed_db) as conn:
            start_together.wait()
            try:
                with conn.transaction():
                    inventory.reserve(conn, order_id, product_id, 1)
                return "reserved"
            except InsufficientStock:
                return "refused"
            except psycopg.Error as error:  # anything else is a bug: report it
                return f"database error: {type(error).__name__}"

    with ThreadPoolExecutor(max_workers=buyers) as pool:
        results = list(pool.map(checkout, order_ids))

    assert sorted(results) == ["refused"] * (buyers - units) + ["reserved"] * units
    with db.connect(committed_db) as conn:
        assert stock(conn, product_id) == (units, units, 0)
        assert violations(conn, STOCK_INVARIANTS) == NO_STOCK_VIOLATIONS

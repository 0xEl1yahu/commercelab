"""Tests for customers.find_or_create: one customer per email, whatever its case,
even when two first-time checkouts arrive together."""

import threading
import time

import pytest

from commercelab.data import db
from commercelab.domain import customers, orders
from commercelab.domain.customers import Contact
from tests.support.fakes import DELIVERY, ScriptedProvider, make_shop
from tests.support.invariants import assert_all_hold as assert_invariants

SAM = Contact(email="Sam@Northfold.co.uk", name="Sam Reid", phone="07700 900123")


def customer_rows(conn, email):
    return conn.execute(
        "SELECT id, name, email, phone FROM customers WHERE lower(email) = lower(%s)", [email]
    ).fetchall()


def test_creates_a_customer_once_per_email_case_insensitively(conn):
    first = customers.find_or_create(conn, SAM)
    again = customers.find_or_create(
        conn, Contact(email="sam@northfold.co.uk", name="Sam Reid", phone="07700 900123"))
    shouted = customers.find_or_create(
        conn, Contact(email="SAM@NORTHFOLD.CO.UK", name="Sam Reid", phone="07700 900123"))

    assert first == again == shouted
    assert customer_rows(conn, SAM.email) == [
        (first, "Sam Reid", "Sam@Northfold.co.uk", "07700 900123")  # stored as first typed
    ]


def test_different_emails_are_different_customers(conn):
    sam = customers.find_or_create(conn, SAM)
    other = customers.find_or_create(
        conn, Contact(email="sam@elsewhere.co.uk", name="Sam Reid", phone="07700 900123"))
    assert sam != other


def test_existing_customer_name_is_not_overwritten(conn):
    existing = make_shop(conn)["customer"]  # 'Ann', ann@example.com, no phone
    found = customers.find_or_create(
        conn, Contact(email="ANN@example.com", name="Mallory", phone="07700 900999"))

    assert found == existing
    assert customer_rows(conn, "ann@example.com") == [(existing, "Ann", "ann@example.com", None)]


# --- concurrency: two first-time checkouts with one new email ------------------------------

def wait_until_waiting_on_a_lock(observer, backend_pid: int, worker: threading.Thread):
    """Return once the worker's connection is blocked on a lock.

    Fails if the worker finishes first: then the two connections never
    overlapped and the test would prove nothing. Polls pg_stat_activity; no
    sleeping, so nothing depends on timing guesses.
    """
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        waiting_on = observer.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [backend_pid]
        ).fetchone()[0]
        if waiting_on == "Lock":
            return
        if not worker.is_alive():
            pytest.fail("the second checkout never waited for the first: no race happened")
    pytest.fail("timed out waiting for the second checkout to block")


def run_in_thread(target, outcome: dict, name: str) -> threading.Thread:
    def run():
        try:
            outcome[name] = target()
        # Deliberately broad: an exception in a thread would otherwise vanish.
        except Exception as error:  # noqa: BLE001
            outcome[name] = error

    worker = threading.Thread(target=run)
    worker.start()
    return worker


def committed_shop(url):
    with db.connect(url) as conn, conn.transaction():
        return make_shop(conn)


@pytest.mark.concurrency
def test_concurrent_first_checkouts_with_one_email_create_one_customer(committed_db):
    """Worst case: checkout B looks for the customer while checkout A has created
    them but not yet committed. B must wait for A, then use A's customer."""
    shop = committed_shop(committed_db)
    a_created_customer = threading.Event()
    a_may_commit = threading.Event()
    outcome = {}

    def checkout_a():
        with db.connect(committed_db) as conn:
            with conn.transaction():
                customer_id = customers.find_or_create(conn, SAM)
                a_created_customer.set()
                a_may_commit.wait(timeout=10)
            # committed: the rest of A's checkout, with no transaction open
            return orders.checkout(
                conn, ScriptedProvider(), customer_id=customer_id,
                items=[(shop["mouse"], 1)], address=DELIVERY, idempotency_key="a")

    def checkout_b(conn):
        return orders.guest_checkout(
            conn, ScriptedProvider(),
            contact=Contact(email="sam@northfold.co.uk", name="Sam Reid", phone="07700 900123"),
            address=DELIVERY, items=[(shop["mouse"], 1)], idempotency_key="b")

    with db.connect(committed_db) as b_conn, db.connect(committed_db) as observer:
        worker_a = run_in_thread(checkout_a, outcome, "a")
        assert a_created_customer.wait(timeout=10)
        worker_b = run_in_thread(lambda: checkout_b(b_conn), outcome, "b")
        try:
            wait_until_waiting_on_a_lock(observer, b_conn.info.backend_pid, worker_b)
        finally:
            a_may_commit.set()
            worker_a.join(timeout=10)
            worker_b.join(timeout=10)

    a, b = outcome["a"], outcome["b"]
    assert not isinstance(a, Exception), a
    assert not isinstance(b, Exception), b  # no unique violation, so no 500
    assert (a.order["status"], b.order["status"]) == ("paid", "paid")
    with db.connect(committed_db) as conn:
        rows = customer_rows(conn, SAM.email)
        assert len(rows) == 1
        owners = {row[0] for row in conn.execute("SELECT customer_id FROM orders")}
        assert owners == {rows[0][0]}  # both orders belong to that one customer
        assert_invariants(conn)


@pytest.mark.concurrency
def test_a_rolled_back_first_checkout_leaves_the_email_free(committed_db):
    """If A's transaction rolls back, the waiting B creates the customer itself."""
    a_created_customer = threading.Event()
    a_may_finish = threading.Event()
    outcome = {}

    def checkout_a():
        with db.connect(committed_db) as conn, conn.transaction(force_rollback=True):
            customers.find_or_create(conn, SAM)
            a_created_customer.set()
            a_may_finish.wait(timeout=10)

    with db.connect(committed_db) as b_conn, db.connect(committed_db) as observer:
        worker_a = run_in_thread(checkout_a, outcome, "a")
        assert a_created_customer.wait(timeout=10)
        worker_b = run_in_thread(
            lambda: customers.find_or_create(b_conn, SAM), outcome, "b")
        try:
            wait_until_waiting_on_a_lock(observer, b_conn.info.backend_pid, worker_b)
        finally:
            a_may_finish.set()
            worker_a.join(timeout=10)
            worker_b.join(timeout=10)

    assert isinstance(outcome["b"], int), outcome["b"]
    with db.connect(committed_db) as conn:
        assert [row[0] for row in customer_rows(conn, SAM.email)] == [outcome["b"]]

"""Tests for data/db.py: the pool lifecycle and the transaction rule.

Most tests here use `committed_db` or `pool`, not `conn`: the point is to prove
what really gets committed, which a rolled-back test connection cannot show.
"""

import psycopg
import pytest

from data import db

INSERT_PRODUCT = (
    "INSERT INTO products (sku, name, category, price, unit_cost) "
    "VALUES (%s, 'Test', 'test', 1.00, 0.50)"
)


def product_exists(url: str, sku: str) -> bool:
    """Look from a separate connection, so only committed rows are visible."""
    with db.connect(url) as observer:
        return (
            observer.execute("SELECT 1 FROM products WHERE sku = %s", [sku]).fetchone()
            is not None
        )


# --- connections ------------------------------------------------------------------


def test_connect_gives_an_autocommit_connection(committed_db):
    with db.connect(committed_db) as conn:
        assert conn.autocommit is True
        assert db.ping(conn) is True


def test_pooled_connections_are_autocommit(pool):
    with db.connection() as conn:
        assert conn.autocommit is True
        assert db.ping(conn) is True


# --- the transaction rule -----------------------------------------------------------


def test_transaction_block_commits_when_it_ends(committed_db):
    with db.connect(committed_db) as conn:
        with conn.transaction():
            conn.execute(INSERT_PRODUCT, ["COMMITTED"])
            assert not product_exists(committed_db, "COMMITTED")  # not visible yet
        assert product_exists(committed_db, "COMMITTED")  # visible after the block


def test_transaction_block_rolls_back_everything_on_error(committed_db):
    with (
        db.connect(committed_db) as conn,
        pytest.raises(RuntimeError),
        conn.transaction(),
    ):
        conn.execute(INSERT_PRODUCT, ["FIRST"])
        conn.execute(INSERT_PRODUCT, ["SECOND"])
        raise RuntimeError("payment provider timed out")
    assert not product_exists(committed_db, "FIRST")
    assert not product_exists(committed_db, "SECOND")


def test_failed_statement_rolls_back_earlier_statements_in_the_block(committed_db):
    with (
        db.connect(committed_db) as conn,
        pytest.raises(psycopg.errors.CheckViolation),
        conn.transaction(),
    ):
        conn.execute(INSERT_PRODUCT, ["VALID"])
        conn.execute("UPDATE products SET price = -1 WHERE sku = 'VALID'")
    assert not product_exists(committed_db, "VALID")


def test_without_a_transaction_block_each_statement_commits_alone(committed_db):
    """Why writes must be wrapped: in autocommit mode, a bare statement is final."""
    with db.connect(committed_db) as conn:
        conn.execute(INSERT_PRODUCT, ["BARE"])
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE products SET price = -1 WHERE sku = 'BARE'")
    assert product_exists(committed_db, "BARE")  # the first statement was not undone


def test_transaction_inside_the_test_fixture_is_only_a_savepoint(conn, database_url):
    """Why test isolation works: the same block commits nothing under `conn`.

    Deliberately the test's first statement: this failed before the fixture
    opened its outer transaction up front, because an idle connection turned
    this block into a real, committed transaction.
    """
    with conn.transaction():
        conn.execute(INSERT_PRODUCT, ["SAVEPOINT"])
    assert not product_exists(
        database_url, "SAVEPOINT"
    )  # still inside the outer transaction
    assert conn.info.transaction_status == psycopg.pq.TransactionStatus.INTRANS


# --- pool lifecycle ---------------------------------------------------------------


def test_connection_before_open_pool_fails_clearly():
    with pytest.raises(RuntimeError, match="not open"), db.connection():
        pass


def test_opening_the_pool_twice_fails(pool):
    with pytest.raises(RuntimeError, match="already open"):
        db.open_pool()


def test_connections_return_to_the_pool(pool):
    available_before = pool.get_stats()["pool_available"]
    with db.connection():
        assert pool.get_stats()["pool_available"] == available_before - 1
    assert pool.get_stats()["pool_available"] == available_before


def test_close_pool_allows_reopening(committed_db):
    db.open_pool(committed_db)
    db.close_pool()
    db.open_pool(committed_db)
    db.close_pool()


# --- FastAPI dependency ----------------------------------------------------------


def test_get_conn_returns_the_connection_even_if_the_request_fails(pool):
    available_before = pool.get_stats()["pool_available"]
    request = db.get_conn()
    conn = next(request)  # FastAPI does this before the route runs
    assert db.ping(conn)
    with pytest.raises(ValueError):
        request.throw(ValueError("route raised"))  # ...and this if the route raises
    assert pool.get_stats()["pool_available"] == available_before

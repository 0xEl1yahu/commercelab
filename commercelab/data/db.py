"""PostgreSQL connections for CommerceLab: the pool, and the transaction rule.

This module knows how to talk to Postgres and nothing else. It has no SQL about
products or orders; that lives in the modules that own those rules.

THE TRANSACTION RULE
    Every connection handed out here is in autocommit mode. Anything that must
    be atomic goes inside an explicit block:

        with conn.transaction():
            ...  # all of this commits together, or none of it does

    Why autocommit: without it, psycopg silently opens a transaction at the
    first statement, and a later conn.transaction() becomes a *savepoint* inside
    it. Checkout would believe it had committed the stock reservation before
    calling the payment provider, when it had only released a savepoint.
    With autocommit, conn.transaction() is always a real BEGIN ... COMMIT.

    In tests, the `conn` fixture hands over a connection already inside an
    outer transaction that always rolls back. The same `with conn.transaction():`
    blocks then become savepoints inside it and are undone when the test ends.
    Domain code is identical in both cases; only the connection it is given
    differs.

WHO USES WHAT
    FastAPI routes   get_conn()             (a dependency; tests override it)
    Scripts          connect()              (one standalone connection, no pool)
    App start/stop   open_pool() / close_pool()
"""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

from commercelab.config import settings

# Fail fast at startup if Postgres is unreachable, rather than on the first request.
POOL_OPEN_TIMEOUT_SECONDS = 5.0
# How long a request waits for a free connection before failing.
CONNECTION_WAIT_SECONDS = 10.0

_CONNECTION_KWARGS = {"autocommit": True}

_pool: ConnectionPool | None = None


def connect(url: str | None = None) -> psycopg.Connection:
    """One standalone connection with the app's settings. For scripts, not requests.

    Use as `with connect() as conn:`. Leaving the block closes the connection.
    """
    return psycopg.connect(url or settings.database_url, **_CONNECTION_KWARGS)


def open_pool(url: str | None = None) -> ConnectionPool:
    """Create and open the shared pool. Call once at application startup."""
    global _pool
    if _pool is not None:
        raise RuntimeError("Connection pool is already open")
    pool = ConnectionPool(
        url or settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        kwargs=_CONNECTION_KWARGS,
        # Before lending out a connection, check it still works, so a dropped
        # database connection is replaced instead of failing a request.
        check=ConnectionPool.check_connection,
        timeout=CONNECTION_WAIT_SECONDS,
        name="commercelab",
        open=False,
    )
    # wait=True blocks until min_size connections exist, or raises PoolTimeout.
    pool.open(wait=True, timeout=POOL_OPEN_TIMEOUT_SECONDS)
    _pool = pool
    return pool


def close_pool() -> None:
    """Close every pooled connection. Call once at application shutdown."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """Borrow a connection from the pool; it goes back when the block ends."""
    if _pool is None:
        raise RuntimeError("Connection pool is not open: call open_pool() at startup")
    with _pool.connection() as conn:
        yield conn


def get_conn() -> Iterator[psycopg.Connection]:
    """FastAPI dependency: one pooled connection per request.

    A route declares `conn: psycopg.Connection = Depends(get_conn)` and passes it
    to catalogue.py, orders.py, etc. Tests replace this dependency with one that
    yields their rolled-back connection.
    """
    with connection() as conn:
        yield conn


def ping(conn: psycopg.Connection) -> bool:
    """True if the database answers. Used by GET /health."""
    return conn.execute("SELECT 1").fetchone() == (1,)

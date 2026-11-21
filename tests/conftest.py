"""Shared pytest fixtures.

Tests run against a separate database, commercelab_test by default (override
with TEST_DATABASE_URL). It is created if missing and rebuilt from commercelab/data/db.sql
once per pytest run.

Each test that asks for `conn` gets a connection inside an open transaction
that is rolled back afterwards: tests never see each other's rows and never
need cleanup. Because of that, functions under test must accept a connection
rather than opening their own. Tests that must prove a real commit use
`committed_db` (or `pool`) instead, which wipes the tables afterwards.
"""

import os
from pathlib import Path

import psycopg
import pytest
from psycopg import conninfo

from commercelab.data import db
from scripts import seed

SCHEMA_FILE = Path(__file__).resolve().parent.parent / "commercelab" / "data" / "db.sql"
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://localhost/commercelab_test"
)
SEED = 42


@pytest.fixture(scope="session")
def database_url() -> str:
    """The test database URL, with a fresh schema. Runs once per pytest session."""
    dbname = conninfo.conninfo_to_dict(TEST_DATABASE_URL).get("dbname", "")
    if not dbname.endswith("_test"):
        pytest.exit(
            f"Refusing to run tests against {dbname!r}: the name must end in '_test'.",
            returncode=1,
        )
    db.create_database_if_missing(TEST_DATABASE_URL)
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as schema_conn:
        schema_conn.execute(SCHEMA_FILE.read_text())  # db.sql has its own BEGIN/COMMIT
    return TEST_DATABASE_URL


@pytest.fixture
def conn(database_url: str):
    """A connection whose work is rolled back when the test ends.

    It is configured like the app's connections (autocommit), but handed over
    already inside an outer transaction that always rolls back. That outer
    block must be opened here, up front: psycopg's conn.transaction() is only
    a savepoint when a transaction is already running. If the test's first
    action were a domain function's `with conn.transaction():`, an idle
    connection would start a real transaction and COMMIT it into the test db.
    """
    connection = psycopg.connect(database_url, autocommit=True)
    try:
        with connection.transaction(force_rollback=True):
            yield connection
    finally:
        connection.close()


@pytest.fixture
def seeded(conn):
    """Load the seed-42 demo dataset into this test's transaction.

    Returns the in-memory plan (products, customers, data) so tests can compare
    the database against what the seed intended to write.
    """
    products, customers, data = seed.generate(SEED)
    seed.write(conn, products, customers, data)
    return products, customers, data


@pytest.fixture
def committed_db(database_url: str):
    """For tests that need real commits: atomicity, pools, concurrent checkouts.

    Rolled-back `conn` tests can't prove that something was committed, or that
    a second connection sees it. Tests using this fixture commit for real; the
    fixture wipes every table afterwards so later tests still start empty.
    """
    yield database_url
    with psycopg.connect(database_url, autocommit=True) as cleanup:
        cleanup.execute(f"TRUNCATE {seed.ALL_TABLES} RESTART IDENTITY")


@pytest.fixture
def client(conn):
    """An HTTP client for the app whose routes all use this test's `conn`.

    The override replaces db.get_conn, so every request runs inside the test's
    rolled-back transaction and sees `seeded` data. The client is created
    without `with`, so the app's lifespan (which opens the real pool against
    settings.database_url) does not run.
    """
    from fastapi.testclient import TestClient

    from commercelab.data import db
    from commercelab.main import app

    app.dependency_overrides[db.get_conn] = lambda: conn
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def pool(committed_db: str):
    """The app's connection pool, opened against the test database."""
    from commercelab.data import db

    opened = db.open_pool(committed_db)
    try:
        yield opened
    finally:
        db.close_pool()

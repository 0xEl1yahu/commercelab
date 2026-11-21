"""Tests for scripts/reset_db.py: the guards and the order of work, with no live database."""

from types import SimpleNamespace

import pytest

from commercelab.config import settings
from scripts import reset_db


class Recorder:
    """Stands in for db.connect, seed.write and friends, and records the order of calls."""

    def __init__(self):
        self.events: list[str] = []
        self.seed_kwargs: dict = {}

    def create_database_if_missing(self, url):
        self.events.append("create")

    def connect(self, url=None):
        self.events.append("connect")
        return FakeConn(self)

    def generate(self, seed):
        return [], [], {}

    def write(self, conn, products, customers, data, **kwargs):
        self.events.append("seed")
        self.seed_kwargs = kwargs


class FakeConn:
    def __init__(self, recorder):
        self.recorder = recorder

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql):
        self.recorder.events.append("schema")

    def transaction(self):
        return self


def fail_if_called(*args, **kwargs):
    raise AssertionError("reset_db touched a database when it should have refused")


def ready_manifest(monkeypatch):
    """One image, cached and readable."""
    image = SimpleNamespace(sha256="ab" * 32)
    monkeypatch.setattr(reset_db.image_manifest, "load_manifest", lambda: {"slug": [image]})
    monkeypatch.setattr(reset_db.image_manifest, "cached_bytes", lambda sha256: b"bytes")


@pytest.fixture
def no_database(monkeypatch):
    """Any attempt to create or connect to a database fails the test."""
    monkeypatch.setattr(reset_db.db, "create_database_if_missing", fail_if_called)
    monkeypatch.setattr(reset_db.db, "connect", fail_if_called)


@pytest.mark.parametrize("dbname", ["shop", "commercelab_test", "commercelab_e2e_copy"])
def test_refuses_unexpected_database_name(monkeypatch, no_database, dbname):
    monkeypatch.setattr(settings, "app_env", "demo")
    monkeypatch.setattr(settings, "database_url", f"postgresql://localhost/{dbname}")

    with pytest.raises(SystemExit, match="Refusing to reset"):
        reset_db.main([])


def test_refuses_outside_demo(monkeypatch, no_database):
    monkeypatch.setattr(settings, "app_env", "live")
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/commercelab")

    with pytest.raises(SystemExit, match="Refusing to reset"):
        reset_db.main([])


def test_missing_image_exits_before_touching_the_database(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "demo")
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/commercelab")
    image = SimpleNamespace(sha256="cd" * 32)
    monkeypatch.setattr(reset_db.image_manifest, "load_manifest", lambda: {"slug": [image]})

    def missing(sha256):
        raise FileNotFoundError(
            f"Image {sha256} is not in .cache/images/; run: uv run python -m scripts.fetch_images"
        )

    monkeypatch.setattr(reset_db.image_manifest, "cached_bytes", missing)
    monkeypatch.setattr(reset_db.db, "create_database_if_missing", fail_if_called)
    monkeypatch.setattr(reset_db.db, "connect", fail_if_called)

    with pytest.raises(SystemExit, match="fetch_images"):
        reset_db.main([])


def test_e2e_database_is_created_schema_applied_then_seeded_in_order(monkeypatch):
    recorder = Recorder()
    monkeypatch.setattr(settings, "app_env", "demo")
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/commercelab_e2e")
    ready_manifest(monkeypatch)
    monkeypatch.setattr(reset_db.db, "create_database_if_missing", recorder.create_database_if_missing)
    monkeypatch.setattr(reset_db.db, "connect", recorder.connect)
    monkeypatch.setattr(reset_db.seed, "generate", recorder.generate)
    monkeypatch.setattr(reset_db.seed, "write", recorder.write)

    reset_db.main([])

    events = recorder.events
    assert events.index("create") < events.index("schema") < events.index("seed")
    assert recorder.seed_kwargs == {"image_bytes": reset_db.image_manifest.cached_bytes}


def test_accepts_e2e_names():
    assert reset_db.allowed("commercelab")
    assert reset_db.allowed("commercelab_e2e")
    assert reset_db.allowed("storefront_e2e")
    assert not reset_db.allowed("shop")
    assert not reset_db.allowed("commercelab_test")
    assert not reset_db.allowed("prod")
    assert not reset_db.allowed("commercelab_e2e_copy")

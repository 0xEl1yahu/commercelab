"""Tests for scripts/reset_db.py: the guards that keep it away from real data."""

import pytest

from commercelab.config import settings
from scripts import reset_db


def fail_if_called(*args, **kwargs):
    raise AssertionError("reset_db touched a database when it should have refused")


@pytest.fixture
def no_database(monkeypatch):
    """Any attempt to create or connect to a database fails the test."""
    monkeypatch.setattr(reset_db.db, "create_database_if_missing", fail_if_called)
    monkeypatch.setattr(reset_db.db, "connect", fail_if_called)


def test_refuses_outside_demo(monkeypatch, no_database):
    monkeypatch.setattr(settings, "app_env", "live")
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/commercelab")

    with pytest.raises(SystemExit, match="Refusing to reset"):
        reset_db.main([])


def test_refuses_unexpected_database_name(monkeypatch, no_database):
    monkeypatch.setattr(settings, "app_env", "demo")
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/shop")

    with pytest.raises(SystemExit, match="Refusing to reset"):
        reset_db.main([])


def test_accepts_e2e_names():
    assert reset_db.allowed("commercelab")
    assert reset_db.allowed("commercelab_e2e")
    assert reset_db.allowed("storefront_e2e")
    assert not reset_db.allowed("shop")
    assert not reset_db.allowed("commercelab_test")
    assert not reset_db.allowed("prod")
    assert not reset_db.allowed("commercelab_e2e_copy")

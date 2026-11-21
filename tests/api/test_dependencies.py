"""Tests for api/dependencies.py: how routes get their payment provider."""

from commercelab.api import dependencies
from commercelab.config import settings


def test_demo_provider_uses_configured_decline_percent(monkeypatch):
    monkeypatch.setattr(settings, "simulated_decline_percent", 0)
    assert dependencies.build_demo_provider().decline_percent == 0
    monkeypatch.setattr(settings, "simulated_decline_percent", 100)
    assert dependencies.build_demo_provider().decline_percent == 100

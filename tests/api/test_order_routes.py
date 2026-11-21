"""HTTP contract for checkout and orders. The rules are tested in test_orders.py;
these check status codes, headers, JSON shape and the provider wiring."""

import pytest

from commercelab.api.dependencies import get_payment_provider
from commercelab.config import settings
from commercelab.main import app
from tests.support.fakes import ScriptedProvider, make_shop


@pytest.fixture
def shop(conn):
    return make_shop(conn)


@pytest.fixture
def provider(client):
    scripted = ScriptedProvider()
    app.dependency_overrides[get_payment_provider] = lambda: scripted
    return scripted  # the `client` fixture clears all overrides afterwards


def post_checkout(client, shop, items, key="key-1", customer=None):
    return client.post(
        "/checkout",
        json={"customer_id": customer or shop["customer"],
              "items": [{"product_id": p, "quantity": q} for p, q in items]},
        headers={"Idempotency-Key": key} if key else {},
    )


@pytest.mark.xfail(strict=True, reason="B5")
def test_checkout_creates_a_paid_order(client, provider, shop):
    response = post_checkout(client, shop, [(shop["keyboard"], 1), (shop["mouse"], 2)])
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "paid"
    assert body["payment_status"] == "succeeded"
    assert body["total"] == "249.00"  # a string, like every price
    assert body["items"] == [
        {"product_id": shop["keyboard"], "quantity": 1, "unit_price": "199.00"},
        {"product_id": shop["mouse"], "quantity": 2, "unit_price": "25.00"},
    ]


@pytest.mark.xfail(strict=True, reason="B5")
def test_retry_with_the_same_key_returns_200_and_the_same_order(client, provider, shop):
    first = post_checkout(client, shop, [(shop["mouse"], 1)])
    again = post_checkout(client, shop, [(shop["mouse"], 1)])
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    assert len(provider.charged) == 1


@pytest.mark.xfail(strict=True, reason="B5")
def test_same_key_different_cart_is_409(client, provider, shop):
    post_checkout(client, shop, [(shop["mouse"], 1)])
    assert post_checkout(client, shop, [(shop["mouse"], 4)]).status_code == 409


@pytest.mark.xfail(strict=True, reason="B5")
def test_not_enough_stock_is_409_with_the_numbers(client, provider, shop):
    response = post_checkout(client, shop, [(shop["keyboard"], 3)])
    assert response.status_code == 409
    body = response.json()
    assert (body["product_id"], body["requested"], body["available"]) == (shop["keyboard"], 3, 2)
    assert provider.calls == 0


@pytest.mark.xfail(strict=True, reason="B5")
def test_declined_payment_returns_the_cancelled_order(client, provider, shop):
    provider.outcome = "failed"
    response = post_checkout(client, shop, [(shop["mouse"], 1)])
    assert response.status_code == 201  # the order exists; its status says what happened
    assert (response.json()["status"], response.json()["payment_status"]) == ("cancelled", "failed")


@pytest.mark.xfail(strict=True, reason="B5")
def test_unknown_payment_outcome_returns_a_pending_order(client, provider, shop):
    provider.down = True
    response = post_checkout(client, shop, [(shop["mouse"], 1)])
    assert (response.json()["status"], response.json()["payment_status"]) == ("pending", "unknown")


def guest_payload(items) -> dict:
    """A valid guest checkout body (contact, address, items) for these items."""
    return {
        "contact": {"email": "ann@example.com", "name": "Ann Lee", "phone": "07700 900000"},
        "address": {"line1": "1 Test Street", "city": "Leeds", "postcode": "LS1 1AA"},
        "items": [{"product_id": p, "quantity": q} for p, q in items],
    }


@pytest.mark.parametrize(
    "case",
    ["missing key", "empty cart", "zero quantity",
     pytest.param("price sent by client", marks=pytest.mark.xfail(strict=True, reason="B5"))],
)
def test_malformed_checkouts_are_422(client, provider, shop, case):
    payload = guest_payload([(shop["mouse"], 1)])
    headers = {"Idempotency-Key": "key-1"}
    if case == "missing key":
        headers = {}
    elif case == "empty cart":
        payload["items"] = []
    elif case == "zero quantity":
        payload["items"][0]["quantity"] = 0
    elif case == "price sent by client":
        payload["items"][0]["unit_price"] = "0.01"  # ignored, not trusted

    response = client.post("/checkout", json=payload, headers=headers)
    if case == "price sent by client":
        assert response.status_code == 201
        assert response.json()["items"][0]["unit_price"] == "25.00"
    else:
        assert response.status_code == 422


def test_live_environment_refuses_checkout_without_a_real_provider(client, shop, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "live")
    response = post_checkout(client, shop, [(shop["mouse"], 1)])
    assert response.status_code == 503

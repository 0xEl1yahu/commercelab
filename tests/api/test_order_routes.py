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


def guest_payload(items, *, email="ann@example.com", **address) -> dict:
    """A valid guest checkout body (contact, address, items) for these items.

    Keyword arguments other than email override or add address fields.
    """
    return {
        "contact": {"email": email, "name": "Ann Lee", "phone": "07700 900000"},
        "address": {"line1": "1 Test Street", "city": "Leeds", "postcode": "LS1 1AA", **address},
        "items": [{"product_id": p, "quantity": q} for p, q in items],
    }


def post_checkout(client, items, key="key-1", **payload):
    return client.post(
        "/checkout",
        json=guest_payload(items, **payload),
        headers={"Idempotency-Key": key} if key else {},
    )


def test_checkout_creates_a_paid_order(client, provider, shop):
    response = post_checkout(client, [(shop["keyboard"], 1), (shop["mouse"], 2)])
    body = response.json()

    assert response.status_code == 201
    assert body["reference"].startswith("CL-")
    assert len(body["token"]) == 32
    assert body["status"] == "paid"
    assert body["payment_status"] == "succeeded"
    assert body["customer_name"] == "Ann Lee"
    assert (body["subtotal"], body["delivery"], body["total"], body["vat_included"]) \
        == ("249.00", "0.00", "249.00", "41.50")  # strings, like every price
    assert body["items"] == [
        {"product_id": shop["keyboard"], "sku": "KB", "product_name": "Keyboard",
         "quantity": 1, "unit_price": "199.00", "line_total": "199.00"},
        {"product_id": shop["mouse"], "sku": "MS", "product_name": "Mouse",
         "quantity": 2, "unit_price": "25.00", "line_total": "50.00"},
    ]
    assert body["address"] == {
        "name": "Ann Lee", "phone": "07700 900000", "company": None, "vat_number": None,
        "line1": "1 Test Street", "line2": None, "city": "Leeds", "postcode": "LS1 1AA",
        "country": "GB",
    }
    assert "id" not in body and "customer_id" not in body


def test_retry_with_the_same_key_returns_200_and_the_same_order(client, provider, shop):
    first = post_checkout(client, [(shop["mouse"], 1)])
    again = post_checkout(client, [(shop["mouse"], 1)])
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    assert len(provider.charged) == 1


def test_same_key_different_cart_is_409(client, provider, shop):
    post_checkout(client, [(shop["mouse"], 1)])
    assert post_checkout(client, [(shop["mouse"], 4)]).status_code == 409


def test_same_key_different_address_is_409(client, provider, shop):
    post_checkout(client, [(shop["mouse"], 1)])
    response = post_checkout(client, [(shop["mouse"], 1)], line1="2 Other Street")
    assert response.status_code == 409
    assert "Idempotency key" in response.json()["detail"]
    assert len(provider.charged) == 1


def test_not_enough_stock_is_409_with_the_numbers(client, provider, shop):
    response = post_checkout(client, [(shop["keyboard"], 3)])
    assert response.status_code == 409
    body = response.json()
    assert (body["product_id"], body["requested"], body["available"]) == (shop["keyboard"], 3, 2)
    assert provider.calls == 0


def test_declined_payment_returns_the_cancelled_order(client, provider, shop):
    provider.outcome = "failed"
    response = post_checkout(client, [(shop["mouse"], 1)])
    assert response.status_code == 201  # the order exists; its status says what happened
    assert (response.json()["status"], response.json()["payment_status"]) == ("cancelled", "failed")


def test_unknown_payment_outcome_returns_a_pending_order(client, provider, shop):
    provider.down = True
    response = post_checkout(client, [(shop["mouse"], 1)])
    assert (response.json()["status"], response.json()["payment_status"]) == ("pending", "unknown")


def test_get_order_by_token_route(client, provider, shop):
    placed = post_checkout(client, [(shop["mouse"], 1)]).json()
    response = client.get(f"/orders/{placed['token']}")
    assert response.status_code == 200
    assert response.json() == placed


def test_unknown_token_is_404(client, provider, shop):
    post_checkout(client, [(shop["mouse"], 1)])
    token = "0" * 32
    response = client.get(f"/orders/{token}")
    assert response.status_code == 404
    assert response.json() == {"detail": f"No order {token!r}"}


def test_numeric_order_route_is_gone(client, conn, provider, shop):
    post_checkout(client, [(shop["mouse"], 1)])
    order_id = conn.execute("SELECT id FROM orders").fetchone()[0]
    assert client.get(f"/orders/{order_id}").status_code == 404
    assert client.get("/orders/1").status_code == 404


@pytest.mark.parametrize(
    ("field", "value"),
    [("email", "not-an-email"), ("email", "ann@example"), ("email", "ann @example.com"),
     ("postcode", "LS1"), ("postcode", "LS1-1AA"), ("postcode", "LS1 1AA 9")],
)
def test_invalid_email_or_postcode_is_422(client, conn, provider, shop, field, value):
    response = post_checkout(client, [(shop["mouse"], 1)], **{field: value})
    assert response.status_code == 422
    assert provider.calls == 0
    assert conn.execute("SELECT count(*) FROM orders").fetchone()[0] == 0


def test_blank_optional_address_fields_become_null(client, conn, provider, shop):
    response = post_checkout(
        client, [(shop["mouse"], 1)], line2="", company="   ", vat_number="")
    address = response.json()["address"]

    assert response.status_code == 201
    assert (address["line2"], address["company"], address["vat_number"]) == (None, None, None)
    stored = conn.execute("SELECT line2, company, vat_number FROM order_addresses").fetchone()
    assert stored == (None, None, None)


def test_guest_checkout_reuses_customer_by_email(client, conn, provider, shop):
    first = post_checkout(client, [(shop["mouse"], 1)], key="k1", email="Sam@Northfold.co.uk")
    second = post_checkout(client, [(shop["mouse"], 1)], key="k2", email="sam@northfold.co.uk")

    assert (first.status_code, second.status_code) == (201, 201)
    rows = conn.execute(
        "SELECT id, email FROM customers WHERE lower(email) = 'sam@northfold.co.uk'"
    ).fetchall()
    assert [email for _, email in rows] == ["Sam@Northfold.co.uk"]
    owners = conn.execute("SELECT DISTINCT customer_id FROM orders").fetchall()
    assert owners == [(rows[0][0],)]


def test_unknown_product_is_422(client, conn, provider, shop):
    missing = shop["mouse"] + 1000
    response = post_checkout(client, [(shop["mouse"], 1), (missing, 1)])
    assert response.status_code == 422
    assert str(missing) in response.json()["detail"]
    assert provider.calls == 0
    assert conn.execute("SELECT count(*) FROM orders").fetchone()[0] == 0


@pytest.mark.parametrize(
    "case",
    ["missing key", "empty cart", "zero quantity", "price sent by client"],
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
    response = post_checkout(client, [(shop["mouse"], 1)])
    assert response.status_code == 503

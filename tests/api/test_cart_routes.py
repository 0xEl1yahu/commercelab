"""HTTP contract of POST /cart/quote."""

from tests.support.fakes import make_catalogue


def test_quote_route_returns_strings_and_no_unit_cost(client, conn):
    p = make_catalogue(conn)["products"]
    response = client.post(
        "/cart/quote", json={"items": [{"product_id": p["hero"], "quantity": 1}]}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["subtotal"] == "119.00"
    assert body["delivery"] == "0.00"
    assert body["total"] == "119.00"
    assert body["vat_included"] == "19.83"
    line = body["lines"][0]
    assert line["line_total"] == "119.00"
    assert line["product"]["price"] == "119.00"
    assert "unit_cost" not in response.text
    assert "available" not in line["product"]


def test_quote_with_huge_quantity_is_200_and_limited(client, conn):
    p = make_catalogue(conn)["products"]
    response = client.post(
        "/cart/quote", json={"items": [{"product_id": p["budget"], "quantity": 10_000}]}
    )
    assert response.status_code == 200
    line = response.json()["lines"][0]
    assert line["quantity"] == 100 and line["limited"] is True


def test_quote_over_200_lines_is_422(client, conn):
    items = [{"product_id": i, "quantity": 1} for i in range(1, 202)]
    assert client.post("/cart/quote", json={"items": items}).status_code == 422

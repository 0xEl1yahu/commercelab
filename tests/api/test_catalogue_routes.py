"""Tests for main.py: the HTTP contract. Domain rules are tested in test_catalogue.py;
these check what crosses the wire: status codes, JSON shape, validation, wiring."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from commercelab.config import settings
from commercelab.data import db
from commercelab.domain import catalogue
from commercelab.main import app
from scripts import seed

PRODUCT_FIELDS = {"id", "sku", "name", "category", "price", "available"}


def product_id_by_sku(conn, sku: str) -> int:
    return conn.execute("SELECT id FROM products WHERE sku = %s", [sku]).fetchone()[0]


# --- /health ----------------------------------------------------------------------

def test_health_is_ok_when_the_database_answers(pool):
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_is_503_when_the_database_fails(pool, monkeypatch):
    def database_down(conn):
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(db, "ping", database_down)
    response = TestClient(app).get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unreachable"}


# --- app lifecycle --------------------------------------------------------------

def test_startup_opens_the_pool_and_shutdown_closes_it(database_url, monkeypatch):
    monkeypatch.setattr(settings, "database_url", database_url)  # never the dev db
    with TestClient(app) as client:  # `with` runs the lifespan
        assert client.get("/health").status_code == 200
    with pytest.raises(RuntimeError, match="not open"), db.connection():
        pass  # pool is closed again after shutdown


# --- GET /products ----------------------------------------------------------------

def test_list_products_returns_a_page_envelope(client, seeded):
    body = client.get("/products").json()
    assert set(body) == {"items", "limit", "offset"}
    assert body["limit"] == catalogue.DEFAULT_PAGE_SIZE
    assert body["offset"] == 0
    assert len(body["items"]) == catalogue.DEFAULT_PAGE_SIZE


def test_products_expose_only_public_fields(client, seeded):
    items = client.get("/products", params={"limit": 100}).json()["items"]
    assert all(set(item) == PRODUCT_FIELDS for item in items)  # no unit_cost, no active


def test_prices_are_json_strings_not_floats(client, seeded):
    items = client.get("/products", params={"limit": 100}).json()["items"]
    assert all(isinstance(item["price"], str) for item in items)
    keyboard = next(i for i in items if i["sku"] == seed.LIMITED_SKU)
    assert keyboard["price"] == "199.00"


def test_paging_and_category_reach_the_catalogue(client, seeded):
    response = client.get("/products", params={"category": "keyboards", "limit": 2, "offset": 1})
    body = response.json()
    assert response.status_code == 200
    assert (body["limit"], body["offset"]) == (2, 1)
    assert len(body["items"]) == 2
    assert {item["category"] for item in body["items"]} == {"keyboards"}


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": catalogue.MAX_PAGE_SIZE + 1}, {"offset": -1}, {"limit": "ten"}],
    ids=["limit zero", "limit above max", "negative offset", "non-numeric limit"],
)
def test_invalid_paging_is_rejected_with_422(client, params):
    assert client.get("/products", params=params).status_code == 422


# --- GET /products/{id} -----------------------------------------------------------

def test_get_product_returns_the_product(client, conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    response = client.get(f"/products/{keyboard_id}")
    assert response.status_code == 200
    assert response.json() == {
        "id": keyboard_id, "sku": seed.LIMITED_SKU, "name": "Limited Edition Keyboard",
        "category": "keyboards", "price": "199.00", "available": 2,
    }


def test_missing_product_is_404_with_a_message(client, conn, seeded):
    missing_id = conn.execute("SELECT max(id) + 1000 FROM products").fetchone()[0]
    response = client.get(f"/products/{missing_id}")
    assert response.status_code == 404
    assert response.json() == {"detail": f"No active product with id {missing_id}"}


def test_inactive_product_is_404(client, conn, seeded):
    inactive_id = conn.execute("SELECT id FROM products WHERE NOT active").fetchone()[0]
    assert client.get(f"/products/{inactive_id}").status_code == 404


def test_non_numeric_product_id_is_422(client):
    assert client.get("/products/not-a-number").status_code == 422


# --- GET /categories --------------------------------------------------------------

def test_categories_match_the_catalogue(client, conn, seeded):
    response = client.get("/categories")
    assert response.status_code == 200
    assert response.json() == catalogue.list_categories(conn)


# --- API contract -----------------------------------------------------------------

def test_openapi_schema_documents_the_public_product_shape():
    schema = app.openapi()
    product = schema["components"]["schemas"]["ProductOut"]
    assert set(product["properties"]) == PRODUCT_FIELDS
    assert {"/health", "/products", "/products/{product_id}", "/categories"} <= set(
        schema["paths"]
    )

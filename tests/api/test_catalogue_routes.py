"""Tests for main.py: the HTTP contract. Domain rules are tested in test_catalogue.py;
these check what crosses the wire: status codes, JSON shape, validation, wiring."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from commercelab.config import settings
from commercelab.data import db
from commercelab.domain import catalogue
from commercelab.main import app
from tests.support.fakes import make_catalogue

CARD_FIELDS = {
    "id", "slug", "sku", "name", "brand", "category", "price",
    "stock_status", "stock_left", "image",
}
DETAIL_FIELDS = CARD_FIELDS | {
    "category_title", "tagline", "description", "specs", "images", "vat_included",
}


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

def test_page_has_total_and_facets(client, conn):
    make_catalogue(conn)
    response = client.get("/products", params={"sort": "name", "limit": 2, "offset": 1})
    body = response.json()
    assert response.status_code == 200
    assert set(body) == {"items", "total", "limit", "offset", "facets"}
    assert [item["name"] for item in body["items"]] == ["hero", "low"]
    assert (body["total"], body["limit"], body["offset"]) == (6, 2, 1)
    assert body["facets"] == {
        "brands": ["Halden", "Kestrel", "Marlow"], "min_price": "45.00", "max_price": "180.00",
    }


def test_default_page_size_and_order(client, conn):
    make_catalogue(conn)
    body = client.get("/products").json()
    assert body["limit"] == catalogue.DEFAULT_PAGE_SIZE
    assert body["offset"] == 0
    assert body["items"][0]["name"] == "premium"  # featured: newest first
    assert body["items"][-1]["name"] == "sold_out"


def test_brand_query_is_repeatable(client, conn):
    make_catalogue(conn)
    response = client.get("/products", params=[("brand", "Halden"), ("brand", "Kestrel")])
    assert {item["brand"] for item in response.json()["items"]} == {"Halden", "Kestrel"}
    assert response.json()["total"] == 4


def test_facets_ignore_the_brand_filter(client, conn):
    make_catalogue(conn)
    body = client.get("/products", params={"category": "keyboards", "brand": "Halden"}).json()
    assert body["total"] == 2
    assert body["facets"]["brands"] == ["Halden", "Marlow"]


def test_price_and_stock_filters_reach_the_catalogue(client, conn):
    make_catalogue(conn)
    body = client.get(
        "/products",
        params={"min_price": "59", "max_price": "119.00", "in_stock": "true", "sort": "price_asc"},
    ).json()
    assert [item["name"] for item in body["items"]] == ["mid", "hero"]  # sold_out (64) is hidden


def test_min_above_max_is_422(client, conn):
    make_catalogue(conn)
    response = client.get("/products", params={"min_price": "100", "max_price": "50"})
    assert response.status_code == 422
    assert "min_price" in response.json()["detail"]


def test_unknown_sort_is_422(client):
    assert client.get("/products", params={"sort": "cheapest"}).status_code == 422


def test_offset_past_the_end_is_200_with_true_total(client, conn):
    make_catalogue(conn)
    response = client.get("/products", params={"offset": 500})
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 6


def test_no_available_field_in_listing(client, conn):
    make_catalogue(conn)
    items = client.get("/products", params={"limit": 100}).json()["items"]
    assert items
    assert all(set(item) == CARD_FIELDS for item in items)  # no unit_cost, active or available
    low = next(item for item in items if item["name"] == "low")
    assert (low["stock_status"], low["stock_left"]) == ("low_stock", 2)


def test_prices_are_json_strings_not_floats(client, conn):
    make_catalogue(conn)
    items = client.get("/products", params={"limit": 100}).json()["items"]
    assert all(isinstance(item["price"], str) for item in items)
    assert next(i for i in items if i["name"] == "hero")["price"] == "119.00"


def test_category_reaches_the_catalogue(client, conn):
    make_catalogue(conn)
    body = client.get("/products", params={"category": "mice"}).json()
    assert {item["category"] for item in body["items"]} == {"mice"}
    assert body["total"] == 2


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": catalogue.MAX_PAGE_SIZE + 1}, {"offset": -1}, {"limit": "ten"}],
    ids=["limit zero", "limit above max", "negative offset", "non-numeric limit"],
)
def test_invalid_paging_is_rejected_with_422(client, params):
    assert client.get("/products", params=params).status_code == 422


# --- GET /products/{id} -----------------------------------------------------------

def test_get_product_returns_the_card(client, conn):
    ids = make_catalogue(conn)["products"]
    response = client.get(f"/products/{ids['low']}")
    assert response.status_code == 200
    assert response.json() == {
        "id": ids["low"], "slug": "low", "sku": "LOW", "name": "low", "brand": "Kestrel",
        "category": "mice", "price": "149.00", "stock_status": "low_stock", "stock_left": 2,
        "image": None,
    }


def test_missing_product_is_404_with_a_message(client, conn):
    make_catalogue(conn)
    response = client.get("/products/999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "No active product with id 999999"}


def test_inactive_product_is_404(client, conn):
    ids = make_catalogue(conn)["products"]
    assert client.get(f"/products/{ids['inactive']}").status_code == 404


def test_non_numeric_product_id_is_422(client):
    assert client.get("/products/not-a-number").status_code == 422


# --- GET /products/by-slug/{slug} -------------------------------------------------

def test_by_slug_returns_vat_as_string(client, conn):
    make_catalogue(conn)
    response = client.get("/products/by-slug/hero")
    body = response.json()
    assert response.status_code == 200
    assert set(body) == DETAIL_FIELDS
    assert body["vat_included"] == "19.83"
    assert body["price"] == "119.00"
    assert body["category_title"] == "Keyboards"
    assert len(body["images"]) == 3
    assert body["image"] == body["images"][0]
    assert body["specs"][0] == {"label": "Layout", "value": "UK ISO, 75%"}


def test_detail_never_includes_unit_cost(client, conn):
    make_catalogue(conn)
    response = client.get("/products/by-slug/hero")
    assert "unit_cost" not in response.json()
    assert "52.00" not in response.text  # hero's unit_cost


def test_unknown_or_inactive_slug_is_404(client, conn):
    make_catalogue(conn)
    for slug in ("no-such-product", "inactive"):
        response = client.get(f"/products/by-slug/{slug}")
        assert response.status_code == 404
        assert response.json() == {"detail": f"No active product {slug!r}"}


# --- GET /categories --------------------------------------------------------------

def test_categories_match_the_catalogue(client, conn):
    make_catalogue(conn)
    response = client.get("/categories")
    assert response.status_code == 200
    assert response.json() == catalogue.list_categories(conn)
    assert [c["slug"] for c in response.json()] == ["keyboards", "mice"]


# --- /collections -----------------------------------------------------------------

def test_collections_list(client, conn):
    make_catalogue(conn)
    response = client.get("/collections")
    assert response.status_code == 200
    assert response.json() == [
        {"slug": "featured", "title": "Featured", "description": "Our pick of the range."}
    ]


def test_collection_returns_its_products_in_order(client, conn):
    make_catalogue(conn)
    body = client.get("/collections/featured").json()
    assert body["slug"] == "featured"
    assert [p["name"] for p in body["products"]] == ["hero", "low", "mid"]
    assert all(set(p) == CARD_FIELDS for p in body["products"])


def test_unknown_collection_is_404(client, conn):
    make_catalogue(conn)
    response = client.get("/collections/nope")
    assert response.status_code == 404
    assert response.json() == {"detail": "No collection 'nope'"}


# --- API contract -----------------------------------------------------------------

def test_openapi_has_product_card_schema():
    schema = app.openapi()
    card = schema["components"]["schemas"]["ProductCardOut"]
    assert set(card["properties"]) == CARD_FIELDS
    assert set(schema["components"]["schemas"]["ProductDetailOut"]["properties"]) == DETAIL_FIELDS
    assert {
        "/health", "/products", "/products/{product_id}", "/products/by-slug/{slug}",
        "/categories", "/collections", "/collections/{slug}",
    } <= set(schema["paths"])

"""Tests for catalogue.py: what the storefront can see, and what it can't."""

from decimal import Decimal

import pytest

import catalogue
from catalogue import ProductNotFound
from scripts import seed


def active_product_ids(conn) -> set[int]:
    return {row[0] for row in conn.execute("SELECT id FROM products WHERE active")}


def product_id_by_sku(conn, sku: str) -> int:
    return conn.execute("SELECT id FROM products WHERE sku = %s", [sku]).fetchone()[0]


def all_pages(conn, page_size: int, **filters) -> list[dict]:
    """Walk list_products page by page until a short page signals the end."""
    products, offset = [], 0
    while True:
        page = catalogue.list_products(conn, limit=page_size, offset=offset, **filters)
        products.extend(page)
        if len(page) < page_size:
            return products
        offset += page_size


# --- visibility -----------------------------------------------------------------

def test_lists_only_active_products(conn, seeded):
    listed = {p["id"] for p in all_pages(conn, catalogue.MAX_PAGE_SIZE)}
    assert listed == active_product_ids(conn)


def test_inactive_product_cannot_be_fetched_by_id(conn, seeded):
    inactive_id = conn.execute("SELECT id FROM products WHERE NOT active").fetchone()[0]
    with pytest.raises(ProductNotFound):
        catalogue.get_product(conn, inactive_id)


def test_missing_product_raises_not_found(conn, seeded):
    missing_id = conn.execute("SELECT max(id) + 1000 FROM products").fetchone()[0]
    with pytest.raises(ProductNotFound) as raised:
        catalogue.get_product(conn, missing_id)
    assert raised.value.product_id == missing_id


def test_unit_cost_is_never_exposed(conn, seeded):
    expected_fields = {"id", "sku", "name", "category", "price", "available"}
    some_id = next(iter(active_product_ids(conn)))
    assert set(catalogue.get_product(conn, some_id)) == expected_fields
    assert all(set(p) == expected_fields for p in catalogue.list_products(conn))


# --- filtering, ordering, pagination ------------------------------------------

def test_category_filter_returns_only_that_category(conn, seeded):
    total = 0
    for category in catalogue.list_categories(conn):
        products = all_pages(conn, catalogue.MAX_PAGE_SIZE, category=category)
        assert products, f"category {category!r} listed but has no products"
        assert {p["category"] for p in products} == {category}
        total += len(products)
    assert total == len(active_product_ids(conn))  # categories partition the catalogue


def test_unknown_category_returns_empty_list(conn, seeded):
    assert catalogue.list_products(conn, category="no-such-category") == []


def test_products_are_sorted_by_name_case_insensitively_then_id(conn, seeded):
    products = all_pages(conn, catalogue.MAX_PAGE_SIZE)
    keys = [(p["name"].lower(), p["id"]) for p in products]
    assert keys == sorted(keys)
    names = [p["name"] for p in products]
    # The case that exposed the locale dependence: plain code-point order would
    # put "LED Desk Lamp" first because 'E' < 'a'.
    assert names.index("Laptop Stand") < names.index("LED Desk Lamp")


@pytest.mark.parametrize("page_size", [1, 5, 7, 100])
def test_paging_returns_every_product_exactly_once(conn, seeded, page_size):
    ids = [p["id"] for p in all_pages(conn, page_size)]
    assert len(ids) == len(set(ids))            # no product repeated across pages
    assert set(ids) == active_product_ids(conn)  # and none skipped


@pytest.mark.parametrize(
    ("limit", "offset"),
    [(0, 0), (catalogue.MAX_PAGE_SIZE + 1, 0), (10, -1)],
    ids=["limit zero", "limit above max", "negative offset"],
)
def test_rejects_invalid_paging(conn, limit, offset):
    with pytest.raises(ValueError):
        catalogue.list_products(conn, limit=limit, offset=offset)


def test_list_categories_is_sorted_and_distinct(conn, seeded):
    categories = catalogue.list_categories(conn)
    assert categories == sorted(set(categories))
    assert "keyboards" in categories


# --- prices and availability ----------------------------------------------------

def test_prices_are_exact_decimals_at_the_current_price(conn, seeded):
    current = dict(conn.execute("SELECT id, price FROM products WHERE active").fetchall())
    for product in all_pages(conn, catalogue.MAX_PAGE_SIZE):
        assert isinstance(product["price"], Decimal)
        assert product["price"] == current[product["id"]]


def test_limited_keyboard_shows_two_available(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    assert catalogue.get_product(conn, keyboard_id)["available"] == 2


def test_reservations_reduce_availability(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    conn.execute("UPDATE inventory SET reserved = reserved + 1 WHERE product_id = %s",
                 [keyboard_id])
    assert catalogue.get_product(conn, keyboard_id)["available"] == 1


def test_sold_out_product_is_still_listed_with_zero_available(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    conn.execute("UPDATE inventory SET reserved = on_hand WHERE product_id = %s",
                 [keyboard_id])
    listed = {p["id"]: p for p in catalogue.list_products(conn, category="keyboards")}
    assert listed[keyboard_id]["available"] == 0


# --- safety -----------------------------------------------------------------------

def test_sql_injection_in_category_is_treated_as_text(conn, seeded):
    product_count = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    for attack in ["kitchen' OR '1'='1", "x'; DELETE FROM products; --"]:
        assert catalogue.list_products(conn, category=attack) == []
    assert conn.execute("SELECT count(*) FROM products").fetchone()[0] == product_count

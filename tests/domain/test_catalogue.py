"""Tests for catalogue.py: what the storefront can see, and what it can't."""

from decimal import Decimal

import pytest

from commercelab.domain import catalogue
from commercelab.domain.catalogue import ProductNotFound
from scripts import seed
from tests.support.fakes import insert_product, make_catalogue


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

@pytest.mark.xfail(strict=True, reason="B3")
def test_lists_only_active_products(conn, seeded):
    listed = {p["id"] for p in all_pages(conn, catalogue.MAX_PAGE_SIZE)}
    assert listed == active_product_ids(conn)


@pytest.mark.xfail(strict=True, reason="B3")
def test_inactive_product_cannot_be_fetched_by_id(conn, seeded):
    inactive_id = conn.execute("SELECT id FROM products WHERE NOT active").fetchone()[0]
    with pytest.raises(ProductNotFound):
        catalogue.get_product(conn, inactive_id)


@pytest.mark.xfail(strict=True, reason="B3")
def test_missing_product_raises_not_found(conn, seeded):
    missing_id = conn.execute("SELECT max(id) + 1000 FROM products").fetchone()[0]
    with pytest.raises(ProductNotFound) as raised:
        catalogue.get_product(conn, missing_id)
    assert raised.value.product_id == missing_id


@pytest.mark.xfail(strict=True, reason="B3")
def test_unit_cost_is_never_exposed(conn, seeded):
    expected_fields = {"id", "sku", "name", "category", "price", "available"}
    some_id = next(iter(active_product_ids(conn)))
    assert set(catalogue.get_product(conn, some_id)) == expected_fields
    assert all(set(p) == expected_fields for p in catalogue.list_products(conn))


# --- filtering, ordering, pagination ------------------------------------------

@pytest.mark.xfail(strict=True, reason="B3")
def test_category_filter_returns_only_that_category(conn, seeded):
    total = 0
    for category in catalogue.list_categories(conn):
        products = all_pages(conn, catalogue.MAX_PAGE_SIZE, category=category)
        assert products, f"category {category!r} listed but has no products"
        assert {p["category"] for p in products} == {category}
        total += len(products)
    assert total == len(active_product_ids(conn))  # categories partition the catalogue


@pytest.mark.xfail(strict=True, reason="B3")
def test_unknown_category_returns_empty_list(conn, seeded):
    assert catalogue.list_products(conn, category="no-such-category") == []


@pytest.mark.xfail(strict=True, reason="B3")
def test_products_are_sorted_by_name_case_insensitively_then_id(conn, seeded):
    products = all_pages(conn, catalogue.MAX_PAGE_SIZE)
    keys = [(p["name"].lower(), p["id"]) for p in products]
    assert keys == sorted(keys)
    names = [p["name"] for p in products]
    # The case that exposed the locale dependence: plain code-point order would
    # put "LED Desk Lamp" first because 'E' < 'a'.
    assert names.index("Laptop Stand") < names.index("LED Desk Lamp")


@pytest.mark.xfail(strict=True, reason="B3")
@pytest.mark.parametrize("page_size", [1, 5, 7, 100])
def test_paging_returns_every_product_exactly_once(conn, seeded, page_size):
    ids = [p["id"] for p in all_pages(conn, page_size)]
    assert len(ids) == len(set(ids))            # no product repeated across pages
    assert set(ids) == active_product_ids(conn)  # and none skipped


@pytest.mark.xfail(strict=True, reason="B3")
@pytest.mark.parametrize(
    ("limit", "offset"),
    [(0, 0), (catalogue.MAX_PAGE_SIZE + 1, 0), (10, -1)],
    ids=["limit zero", "limit above max", "negative offset"],
)
def test_rejects_invalid_paging(conn, limit, offset):
    with pytest.raises(ValueError):
        catalogue.list_products(conn, limit=limit, offset=offset)


@pytest.mark.xfail(strict=True, reason="B3")
def test_list_categories_is_sorted_and_distinct(conn, seeded):
    categories = catalogue.list_categories(conn)
    assert categories == sorted(set(categories))
    assert "keyboards" in categories


# --- prices and availability ----------------------------------------------------

@pytest.mark.xfail(strict=True, reason="B3")
def test_prices_are_exact_decimals_at_the_current_price(conn, seeded):
    current = dict(conn.execute("SELECT id, price FROM products WHERE active").fetchall())
    for product in all_pages(conn, catalogue.MAX_PAGE_SIZE):
        assert isinstance(product["price"], Decimal)
        assert product["price"] == current[product["id"]]


@pytest.mark.xfail(strict=True, reason="B3")
def test_limited_keyboard_shows_two_available(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    assert catalogue.get_product(conn, keyboard_id)["available"] == 2


@pytest.mark.xfail(strict=True, reason="B3")
def test_reservations_reduce_availability(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    conn.execute("UPDATE inventory SET reserved = reserved + 1 WHERE product_id = %s",
                 [keyboard_id])
    assert catalogue.get_product(conn, keyboard_id)["available"] == 1


@pytest.mark.xfail(strict=True, reason="B3")
def test_sold_out_product_is_still_listed_with_zero_available(conn, seeded):
    keyboard_id = product_id_by_sku(conn, seed.LIMITED_SKU)
    conn.execute("UPDATE inventory SET reserved = on_hand WHERE product_id = %s",
                 [keyboard_id])
    listed = {p["id"]: p for p in catalogue.list_products(conn, category="keyboards")}
    assert listed[keyboard_id]["available"] == 0


# --- safety -----------------------------------------------------------------------

@pytest.mark.xfail(strict=True, reason="B3")
def test_sql_injection_in_category_is_treated_as_text(conn, seeded):
    product_count = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    for attack in ["kitchen' OR '1'='1", "x'; DELETE FROM products; --"]:
        assert catalogue.list_products(conn, category=attack) == []
    assert conn.execute("SELECT count(*) FROM products").fetchone()[0] == product_count


# --- stock bands and categories (frozen in the storefront contract) -------------------

@pytest.mark.parametrize(
    ("available", "band"),
    [(0, ("out_of_stock", None)), (1, ("low_stock", 1)), (5, ("low_stock", 5)),
     (6, ("in_stock", None)), (150, ("in_stock", None))],
)
def test_stock_band(available, band):
    assert catalogue.stock_band(available) == band


def test_low_stock_threshold_is_five():
    assert catalogue.LOW_STOCK_THRESHOLD == 5


def test_categories_in_position_order_with_titles(conn):
    make_catalogue(conn)  # keyboards (position 1) and mice (position 2)
    conn.execute(
        "INSERT INTO categories (slug, title, description, position) VALUES "
        "('zebra', 'Zebra', 'First by position, last by name.', 0), "
        "('empty', 'Empty', 'Only an inactive product.', 3)"
    )
    insert_product(conn, "ZB-1", "Stripe", "10.00", "4.00", category="zebra")
    insert_product(conn, "EM-1", "Gone", "10.00", "4.00", category="empty", active=False)

    assert catalogue.list_categories(conn) == [
        {"slug": "zebra", "title": "Zebra", "description": "First by position, last by name."},
        {"slug": "keyboards", "title": "Keyboards",
         "description": "Low-profile, mechanical and compact."},
        {"slug": "mice", "title": "Mice", "description": "Quiet, ergonomic and precise."},
    ]

"""Tests for catalogue.py: what the storefront can see, and what it can't.

Everything here runs against make_catalogue (see tests/support/fakes.py), not the seed.
"""

from decimal import Decimal

import pytest

from commercelab.domain import catalogue
from commercelab.domain.catalogue import CollectionNotFound, ProductNotFound
from tests.support.fakes import HERO_SPECS, HERO_TAGLINE, insert_product, make_catalogue

CARD_FIELDS = {
    "id", "slug", "sku", "name", "brand", "category", "price",
    "stock_status", "stock_left", "image",
}
DETAIL_FIELDS = CARD_FIELDS | {
    "category_title", "tagline", "description", "specs", "images", "vat_included",
}


def names(conn, listing) -> list[str]:
    return [item["name"] for item in listing["items"]]


def all_pages(conn, page_size: int, **filters) -> list[dict]:
    """Walk list_products page by page until a short page signals the end."""
    products, offset = [], 0
    while True:
        page = catalogue.list_products(conn, limit=page_size, offset=offset, **filters)
        products.extend(page["items"])
        if len(page["items"]) < page_size:
            return products
        offset += page_size


# --- visibility -----------------------------------------------------------------

def test_lists_only_active_products(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, sort="name")
    assert names(conn, listing) == ["budget", "hero", "low", "mid", "premium", "sold_out"]
    assert listing["total"] == 6  # "inactive" is neither listed nor counted


def test_inactive_product_cannot_be_fetched_by_id(conn):
    ids = make_catalogue(conn)["products"]
    with pytest.raises(ProductNotFound):
        catalogue.get_product(conn, ids["inactive"])


def test_inactive_slug_is_not_found(conn):
    make_catalogue(conn)
    with pytest.raises(ProductNotFound):
        catalogue.get_product_by_slug(conn, "inactive")


def test_missing_product_raises_not_found(conn):
    make_catalogue(conn)
    with pytest.raises(ProductNotFound) as raised:
        catalogue.get_product(conn, 999_999)
    assert raised.value.ref == 999_999


def test_product_not_found_message_for_int_ref():
    assert str(ProductNotFound(7)) == "No active product with id 7"
    assert str(ProductNotFound("nope")) == "No active product 'nope'"


def test_get_product_returns_a_card(conn):
    ids = make_catalogue(conn)["products"]
    product = catalogue.get_product(conn, ids["low"])
    assert product == {
        "id": ids["low"], "slug": "low", "sku": "LOW", "name": "low", "brand": "Kestrel",
        "category": "mice", "price": Decimal("149.00"),
        "stock_status": "low_stock", "stock_left": 2, "image": None,
    }


# --- filtering ------------------------------------------------------------------

def test_filter_by_category(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, category="mice", sort="name")
    assert names(conn, listing) == ["low", "mid"]
    assert listing["total"] == 2


def test_unknown_category_is_empty_not_an_error(conn):
    make_catalogue(conn)
    assert catalogue.list_products(conn, category="no-such-category") == {"items": [], "total": 0}


def test_filter_by_brand(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, brands=["Halden"], sort="name")
    assert names(conn, listing) == ["hero", "premium"]


def test_filter_by_two_brands(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, brands=["Halden", "Kestrel"], sort="name")
    assert names(conn, listing) == ["hero", "low", "mid", "premium"]
    assert listing["total"] == 4


def test_unknown_brand_matches_nothing(conn):
    make_catalogue(conn)
    assert catalogue.list_products(conn, brands=["Nobody"])["total"] == 0


def test_brand_filter_is_exact_not_a_pattern(conn):
    make_catalogue(conn)
    assert catalogue.list_products(conn, brands=["Hald%"])["total"] == 0


def test_price_filter_is_inclusive_at_both_ends(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(
        conn, min_price=Decimal("59.00"), max_price=Decimal("149.00"), sort="price_asc"
    )
    assert names(conn, listing) == ["mid", "sold_out", "hero", "low"]  # 59, 64, 119, 149


def test_price_filter_with_one_bound(conn):
    make_catalogue(conn)
    above = catalogue.list_products(conn, min_price=Decimal("149.00"), sort="price_asc")
    assert names(conn, above) == ["low", "premium"]
    below = catalogue.list_products(conn, max_price=Decimal("59.00"), sort="price_asc")
    assert names(conn, below) == ["budget", "mid"]


def test_min_above_max_raises(conn):
    with pytest.raises(ValueError, match="min_price"):
        catalogue.list_products(conn, min_price=Decimal(10), max_price=Decimal(5))


def test_in_stock_only_hides_sold_out(conn):
    make_catalogue(conn)
    everything = catalogue.list_products(conn, sort="name")
    in_stock = catalogue.list_products(conn, in_stock=True, sort="name")
    assert "sold_out" in names(conn, everything)
    assert names(conn, in_stock) == ["budget", "hero", "low", "mid", "premium"]
    assert in_stock["total"] == 5


def test_product_with_no_inventory_row_is_listed_as_out_of_stock(conn):
    make_catalogue(conn)
    insert_product(conn, "NOINV", "No Inventory", "10.00", "4.00", category="keyboards")
    listed = {p["name"]: p for p in all_pages(conn, catalogue.MAX_PAGE_SIZE)}
    assert listed["No Inventory"]["stock_status"] == "out_of_stock"
    assert "No Inventory" not in {
        p["name"] for p in all_pages(conn, catalogue.MAX_PAGE_SIZE, in_stock=True)
    }


def test_filters_combine(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(
        conn, category="keyboards", brands=["Marlow"], in_stock=True, sort="name"
    )
    assert names(conn, listing) == ["budget"]


def test_sql_injection_is_treated_as_text(conn):
    make_catalogue(conn)
    before = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    for attack in ["kitchen' OR '1'='1", "x'; DELETE FROM products; --"]:
        assert catalogue.list_products(conn, category=attack)["total"] == 0
        assert catalogue.list_products(conn, brands=[attack])["total"] == 0
    assert conn.execute("SELECT count(*) FROM products").fetchone()[0] == before


# --- ordering -------------------------------------------------------------------

def test_featured_puts_sold_out_last_then_newest_first(conn):
    make_catalogue(conn)
    # created_at rises hero < low < sold_out < inactive < budget < mid < premium
    listing = catalogue.list_products(conn, sort="featured")
    assert names(conn, listing) == ["premium", "mid", "budget", "low", "hero", "sold_out"]


def test_featured_is_the_default(conn):
    make_catalogue(conn)
    assert catalogue.list_products(conn) == catalogue.list_products(conn, sort="featured")


def test_name_sort_is_case_insensitive_then_id(conn):
    make_catalogue(conn)
    for sku, name in [("LED", "LED Desk Lamp"), ("LAP", "Laptop Stand"), ("LAP2", "laptop stand")]:
        insert_product(conn, sku, name, "20.00", "8.00")
    products = all_pages(conn, catalogue.MAX_PAGE_SIZE, sort="name")
    keys = [(p["name"].lower(), p["id"]) for p in products]
    assert keys == sorted(keys)
    listed = [p["name"] for p in products]
    # Plain code-point order would put "LED Desk Lamp" first because 'E' < 'a'.
    assert listed.index("Laptop Stand") < listed.index("LED Desk Lamp")


def test_price_sorts(conn):
    make_catalogue(conn)
    ascending = catalogue.list_products(conn, sort="price_asc")
    assert names(conn, ascending) == ["budget", "mid", "sold_out", "hero", "low", "premium"]
    descending = catalogue.list_products(conn, sort="price_desc")
    assert names(conn, descending) == ["premium", "low", "hero", "sold_out", "mid", "budget"]


@pytest.mark.parametrize("sort", ["price_asc", "price_desc"])
def test_price_sorts_break_ties_by_name(conn, sort):
    make_catalogue(conn)
    # No two make_catalogue products share a price, so add two that share hero's.
    insert_product(conn, "ZED", "zed", "119.00", "50.00", category="keyboards")
    insert_product(conn, "ALF", "Alf", "119.00", "50.00", category="keyboards")
    listed = names(conn, catalogue.list_products(conn, sort=sort))
    tied = [name for name in listed if name in {"Alf", "hero", "zed"}]
    assert tied == ["Alf", "hero", "zed"]  # by lower(name), whichever way price runs


def test_unknown_sort_raises(conn):
    with pytest.raises(ValueError, match="sort"):
        catalogue.list_products(conn, sort="cheapest")  # type: ignore[arg-type]


# --- paging and totals ---------------------------------------------------------

@pytest.mark.parametrize("page_size", [1, 2, 4, 100])
def test_paging_returns_every_product_exactly_once(conn, page_size):
    make_catalogue(conn)
    # Four products identical in name, price, stock and created_at (all "now"):
    # only the id tie-break keeps their order stable from page to page.
    for sku in ("TWIN-1", "TWIN-2", "TWIN-3", "TWIN-4"):
        insert_product(conn, sku, "Twin", "75.00", "30.00", category="keyboards")
    for sort in ("featured", "name", "price_asc", "price_desc"):
        unpaged = catalogue.list_products(conn, sort=sort, limit=catalogue.MAX_PAGE_SIZE)["items"]
        paged = all_pages(conn, page_size, sort=sort)
        assert paged == unpaged
        ids = [p["id"] for p in paged]
        assert len(ids) == len(set(ids)) == 10


def test_total_counts_all_matches_not_the_page(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, sort="name", limit=2, offset=1)
    assert names(conn, listing) == ["hero", "low"]
    assert listing["total"] == 6


def test_offset_past_the_end_is_empty_with_true_total(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, offset=50)
    assert listing == {"items": [], "total": 6}
    filtered = catalogue.list_products(conn, brands=["Halden"], offset=50)
    assert filtered == {"items": [], "total": 2}


def test_huge_offset_is_past_the_end(conn):
    make_catalogue(conn)
    listing = catalogue.list_products(conn, offset=10**30)
    assert listing == {"items": [], "total": 6}
    assert catalogue.list_products(conn, brands=["Halden"], offset=2**63) == {
        "items": [], "total": 2,
    }


@pytest.mark.parametrize(
    ("limit", "offset"),
    [(0, 0), (catalogue.MAX_PAGE_SIZE + 1, 0), (10, -1)],
    ids=["limit zero", "limit above max", "negative offset"],
)
def test_rejects_invalid_paging(conn, limit, offset):
    with pytest.raises(ValueError):
        catalogue.list_products(conn, limit=limit, offset=offset)


# --- prices, stock bands and what is exposed -------------------------------------

def test_prices_are_exact_decimals(conn):
    make_catalogue(conn)
    prices = {p["name"]: p["price"] for p in all_pages(conn, catalogue.MAX_PAGE_SIZE)}
    assert prices["hero"] == Decimal("119.00")
    assert all(isinstance(price, Decimal) for price in prices.values())


def test_low_product_shows_low_stock_2(conn):
    make_catalogue(conn)
    listed = {p["name"]: p for p in all_pages(conn, catalogue.MAX_PAGE_SIZE)}
    assert (listed["low"]["stock_status"], listed["low"]["stock_left"]) == ("low_stock", 2)
    assert (listed["hero"]["stock_status"], listed["hero"]["stock_left"]) == ("in_stock", None)
    assert (listed["sold_out"]["stock_status"], listed["sold_out"]["stock_left"]) == (
        "out_of_stock", None,
    )


def test_reservations_reduce_availability(conn):
    ids = make_catalogue(conn)["products"]
    conn.execute("UPDATE inventory SET reserved = 1 WHERE product_id = %s", [ids["low"]])
    product = catalogue.get_product(conn, ids["low"])
    assert (product["stock_status"], product["stock_left"]) == ("low_stock", 1)
    conn.execute("UPDATE inventory SET reserved = on_hand WHERE product_id = %s", [ids["low"]])
    assert catalogue.get_product(conn, ids["low"])["stock_status"] == "out_of_stock"


def test_card_has_the_primary_image(conn):
    ids = make_catalogue(conn)["products"]
    image = catalogue.get_product(conn, ids["hero"])["image"]
    assert image is not None
    assert image["alt"] == "Halden hero"  # position 1, not the later gallery shots
    assert len(image["key"]) == 64


def test_unit_cost_is_never_exposed(conn):
    ids = make_catalogue(conn)["products"]
    assert "unit_cost" not in catalogue._PRODUCT_QUERY
    results = [
        catalogue.get_product(conn, ids["hero"]),
        *(p for sort in ("featured", "name", "price_asc", "price_desc")
          for p in catalogue.list_products(conn, sort=sort)["items"]),
        *catalogue.get_collection(conn, "featured")["products"],
    ]
    assert results
    assert all(set(card) == CARD_FIELDS for card in results)
    assert set(catalogue.get_product_by_slug(conn, "hero")) == DETAIL_FIELDS
    assert set(catalogue.listing_facets(conn, category=None)) == {"brands", "min_price", "max_price"}


# --- facets ---------------------------------------------------------------------

def test_facets_for_a_category(conn):
    make_catalogue(conn)
    assert catalogue.listing_facets(conn, category="keyboards") == {
        "brands": ["Halden", "Marlow"],
        "min_price": Decimal("45.00"),
        "max_price": Decimal("180.00"),
    }
    assert catalogue.listing_facets(conn, category="mice") == {
        "brands": ["Kestrel"], "min_price": Decimal("59.00"), "max_price": Decimal("149.00"),
    }


def test_facets_for_the_whole_catalogue_ignore_inactive_products(conn):
    make_catalogue(conn)  # "inactive" is brand Testco at 99.00
    facets = catalogue.listing_facets(conn, category=None)
    assert facets["brands"] == ["Halden", "Kestrel", "Marlow"]
    assert (facets["min_price"], facets["max_price"]) == (Decimal("45.00"), Decimal("180.00"))


def test_facets_ignore_other_filters(conn):
    make_catalogue(conn)
    # The facets function takes only a category, so a brand or price filter on the
    # listing cannot hide the other brands from the filter bar.
    listing = catalogue.list_products(conn, category="keyboards", brands=["Halden"])
    assert listing["total"] == 2
    assert catalogue.listing_facets(conn, category="keyboards")["brands"] == ["Halden", "Marlow"]


def test_facets_are_empty_for_an_unknown_category(conn):
    make_catalogue(conn)
    assert catalogue.listing_facets(conn, category="no-such-category") == {
        "brands": [], "min_price": None, "max_price": None,
    }


def test_facet_brands_are_sorted_alphabetically_ignoring_case(conn):
    make_catalogue(conn)
    for sku, brand in [("A1", "aster"), ("A2", "Zeta"), ("A3", "Orrin")]:
        insert_product(conn, sku, sku, "10.00", "4.00", category="mice", brand=brand)
    brands = catalogue.listing_facets(conn, category="mice")["brands"]
    assert brands == ["aster", "Kestrel", "Orrin", "Zeta"]


# --- product detail -------------------------------------------------------------

def test_detail_has_category_title_specs_images_and_vat(conn):
    ids = make_catalogue(conn)["products"]
    detail = catalogue.get_product_by_slug(conn, "hero")
    assert detail["id"] == ids["hero"]
    assert detail["category_title"] == "Keyboards"
    assert detail["tagline"] == HERO_TAGLINE
    assert detail["description"] == "A low-profile wireless keyboard for long working days."
    assert detail["specs"] == HERO_SPECS
    assert [image["alt"] for image in detail["images"]] == [
        "Halden hero", "Halden hero, side view", "Halden hero, in use",
    ]
    assert detail["image"] == detail["images"][0]
    assert detail["vat_included"] == Decimal("19.83")
    assert detail["price"] == Decimal("119.00")


def test_detail_of_a_product_without_images_or_specs(conn):
    make_catalogue(conn)
    detail = catalogue.get_product_by_slug(conn, "budget")
    assert detail["images"] == []
    assert detail["image"] is None
    assert detail["specs"] == []
    assert detail["tagline"] == ""
    assert detail["vat_included"] == Decimal("7.50")  # 45.00 / 6


def test_detail_images_follow_position_not_insertion_order(conn):
    ids = make_catalogue(conn)["products"]
    swap = "UPDATE product_images SET position = %s WHERE product_id = %s AND position = %s"
    for new, old in ((20, 2), (2, 3), (3, 20)):  # swap positions 2 and 3 via a free slot
        conn.execute(swap, [new, ids["hero"], old])
    detail = catalogue.get_product_by_slug(conn, "hero")
    assert [image["alt"] for image in detail["images"]] == [
        "Halden hero", "Halden hero, in use", "Halden hero, side view",
    ]


def test_unknown_slug_is_not_found(conn):
    make_catalogue(conn)
    with pytest.raises(ProductNotFound) as raised:
        catalogue.get_product_by_slug(conn, "no-such-product")
    assert raised.value.ref == "no-such-product"


# --- collections ----------------------------------------------------------------

def test_collection_in_position_order_hides_inactive(conn):
    ids = make_catalogue(conn)["products"]
    featured = catalogue.get_collection(conn, "featured")
    assert (featured["slug"], featured["title"]) == ("featured", "Featured")
    assert [p["name"] for p in featured["products"]] == ["hero", "low", "mid"]
    # Deactivate the middle one and put an inactive product in the set.
    conn.execute("UPDATE products SET active = false WHERE id = %s", [ids["low"]])
    conn.execute(
        "INSERT INTO collection_products (collection_id, product_id, position) "
        "SELECT id, %s, 4 FROM collections WHERE slug = 'featured'",
        [ids["inactive"]],
    )
    featured = catalogue.get_collection(conn, "featured")
    assert [p["name"] for p in featured["products"]] == ["hero", "mid"]


def test_collection_order_is_its_own_not_the_listing_order(conn):
    ids = make_catalogue(conn)["products"]
    conn.execute(
        "UPDATE collection_products SET position = CASE product_id "
        "WHEN %s THEN 3 WHEN %s THEN 1 ELSE 2 END",
        [ids["hero"], ids["mid"]],
    )
    featured = catalogue.get_collection(conn, "featured")
    assert [p["name"] for p in featured["products"]] == ["mid", "low", "hero"]


def test_collection_products_are_cards(conn):
    make_catalogue(conn)
    products = catalogue.get_collection(conn, "featured")["products"]
    assert {p["name"]: p["stock_status"] for p in products} == {
        "hero": "in_stock", "low": "low_stock", "mid": "in_stock",
    }


def test_unknown_collection_raises(conn):
    make_catalogue(conn)
    with pytest.raises(CollectionNotFound) as raised:
        catalogue.get_collection(conn, "nope")
    assert raised.value.slug == "nope"


def test_list_collections_by_position(conn):
    make_catalogue(conn)
    conn.execute(
        "INSERT INTO collections (slug, title, description, position) VALUES "
        "('spotlight', 'Spotlight', 'Newly arrived.', 0), "
        "('empty', 'Empty', 'Nothing in it yet.', 2)"
    )
    assert catalogue.list_collections(conn) == [
        {"slug": "spotlight", "title": "Spotlight", "description": "Newly arrived."},
        {"slug": "featured", "title": "Featured", "description": "Our pick of the range."},
        {"slug": "empty", "title": "Empty", "description": "Nothing in it yet."},
    ]


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

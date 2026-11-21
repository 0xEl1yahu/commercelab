"""Tests for scripts/catalogue_data.py: the shared identity of the 55 products.

The seed, the image curation and the frontend e2e tests all key off these rows,
so their shape is checked here, independently of any database.
"""

import re
from collections import Counter, defaultdict

from scripts import catalogue_data as cd

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
BRANDS_BY_CATEGORY = {
    "keyboards": {"Halden", "Marlow", "Tessel"},
    "mice": {"Kestrel", "Marlow"},
    "monitors": {"Aster", "Tessel"},
    "audio": {"Orrin", "Marlow"},
    "desk": {"Lumi", "Halden", "Tessel"},
    "cables": {"Corda", "Marlow"},
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def by_sku() -> dict[str, tuple[str, str, str, str, str]]:
    return {row[0]: row for row in cd.PRODUCTS}


def active_rows():
    return [row for row in cd.PRODUCTS if row[0] != cd.DISCONTINUED_SKU]


def test_categories_in_nav_order():
    assert cd.CATEGORIES == [
        ("keyboards", "Keyboards", "Low-profile, mechanical and compact."),
        ("mice", "Mice", "Quiet, ergonomic and precise."),
        ("monitors", "Monitors", "Sharp screens and the arms to hold them."),
        ("audio", "Audio", "Headsets, speakers and microphones for calls."),
        ("desk", "Desk", "Lamps, stands, mats and webcams."),
        ("cables", "Cables & docks", "Docks, hubs and the cables between them."),
    ]


def test_55_products_54_active_9_per_category():
    assert len(cd.PRODUCTS) == 55
    assert Counter(row[4] for row in active_rows()) == {slug: 9 for slug, _, _ in cd.CATEGORIES}


def test_skus_slugs_and_names_are_unique():
    for index in (0, 1, 2):
        values = [row[index] for row in cd.PRODUCTS]
        assert len(values) == len(set(values)), f"column {index} repeats"


def test_slugs_are_brand_and_name_slugified():
    for sku, slug, name, brand, _ in cd.PRODUCTS:
        assert slug == slugify(f"{brand} {name}"), sku
        assert SLUG_PATTERN.fullmatch(slug), sku


def test_names_never_repeat_the_brand():
    for sku, _, name, brand, _ in cd.PRODUCTS:
        assert brand.lower() not in name.lower(), sku


def test_brands_follow_the_allocation_with_at_least_two_per_category():
    brands = defaultdict(set)
    for _, _, _, brand, category in active_rows():
        brands[category].add(brand)
    assert dict(brands) == BRANDS_BY_CATEGORY
    assert all(len(found) >= 2 for found in brands.values())


def test_scenario_products():
    rows = by_sku()
    assert rows[cd.SPOTLIGHT_SKU][2:] == ("Quill Low Profile Wireless Keyboard", "Halden", "keyboards")
    assert rows[cd.SPOTLIGHT_SKU][1] == "halden-quill-low-profile-wireless-keyboard"
    assert rows[cd.LIMITED_SKU][2:] == ("H1 Wireless Headset", "Orrin", "audio")
    assert rows[cd.SOLD_OUT_SKU][2:] == ("Slim 2 Wireless Keyboard", "Marlow", "keyboards")
    assert rows[cd.DISCONTINUED_SKU][2:] == ("Bud 1 Wired Headset", "Marlow", "audio")
    assert cd.LOW_STOCK_SKUS == ("KS-ARC-WHT", "LM-ARC-LAMP")
    assert all(sku in rows for sku in cd.LOW_STOCK_SKUS)
    scenario = [cd.SPOTLIGHT_SKU, cd.LIMITED_SKU, cd.SOLD_OUT_SKU, cd.DISCONTINUED_SKU,
                *cd.LOW_STOCK_SKUS]
    assert len(set(scenario)) == len(scenario)


def test_collections():
    collections = {slug: (title, description, skus) for slug, title, description, skus
                   in cd.COLLECTIONS}
    assert list(collections) == ["spotlight", "featured", "quiet-desk"]
    active = {row[0] for row in active_rows()}
    category = {row[0]: row[4] for row in cd.PRODUCTS}

    assert collections["spotlight"][2] == [cd.SPOTLIGHT_SKU]

    featured = collections["featured"][2]
    assert len(featured) == 8
    assert len({category[sku] for sku in featured}) >= 5
    assert cd.LIMITED_SKU in featured
    assert cd.SOLD_OUT_SKU not in featured

    title, description, quiet = collections["quiet-desk"]
    assert title == "The quiet desk"
    assert description == (
        "Low-profile keyboards, silent mice and warm-light lamps, chosen for long working days."
    )
    assert len(quiet) == 6

    for slug, (title, _, skus) in collections.items():
        assert title, slug
        assert len(skus) == len(set(skus)), slug
        assert set(skus) <= active, f"{slug} has an unknown or inactive sku"


def test_image_count():
    assert cd.IMAGE_COUNT == {"spotlight or featured": 3, "other": 1}

"""Tests for scripts/seed.py: reproducibility, safety and data invariants."""

import hashlib

import psycopg
import pytest

from commercelab.config import settings
from scripts import catalogue_data, image_manifest, seed
from scripts.catalogue_content import CONTENT, LABELS
from tests.support.invariants import INVARIANTS, violations

TABLES = [
    "products", "customers", "orders", "order_items", "inventory",
    "reservations", "stock_movements", "payments", "refunds",
    "categories", "collections", "collection_products", "product_images",
]
# images carries bytes, so it is compared on its keys.


def snapshot(conn: psycopg.Connection) -> dict[str, list[tuple]]:
    """Every row of every table, in a stable order (ORDER BY the whole row)."""
    rows = {t: conn.execute(f"SELECT * FROM {t} ORDER BY {t}").fetchall() for t in TABLES}
    rows["images"] = conn.execute("SELECT sha256 FROM images ORDER BY sha256").fetchall()
    return rows


# --- reproducibility -----------------------------------------------------------

def test_same_seed_generates_identical_data():
    assert seed.generate(42) == seed.generate(42)


def test_different_seed_generates_different_data():
    assert seed.generate(42) != seed.generate(7)


def test_seeding_twice_writes_identical_tables(conn):
    seed.write(conn, *seed.generate(42))
    first = snapshot(conn)
    seed.write(conn, *seed.generate(42))  # TRUNCATE ... RESTART IDENTITY, then reload
    assert snapshot(conn) == first


def test_database_matches_the_plan(conn, seeded):
    products, customers, data = seeded
    planned = {"products": len(products), "customers": len(customers),
               **{t: len(data[t]) for t in TABLES if t in data}}
    assert planned["categories"] == 6
    actual = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
    assert actual == planned
    assert actual["orders"] == seed.N_ORDERS
    assert actual["customers"] == seed.N_CUSTOMERS


# --- safety ----------------------------------------------------------------------

def test_refuses_to_run_outside_demo(monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("seed connected to a database while APP_ENV=live")

    monkeypatch.setattr(settings, "app_env", "live")
    monkeypatch.setattr(seed.db, "connect", fail_if_called)

    with pytest.raises(SystemExit, match="Refusing to seed"):
        seed.main([])


# --- invariants the schema cannot enforce on its own ---------------------------
# The rules themselves live in tests/support/invariants.py, shared with domain tests.


@pytest.mark.parametrize("name", INVARIANTS)
def test_seeded_data_satisfies_invariant(conn, seeded, name):
    assert violations(conn, [name]) == {name: 0}


def test_items_ordered_after_the_reprice_use_the_current_price(conn, seeded):
    """Seed-specific: the seed reprices products on seed.REPRICE_DATE."""
    stale = conn.execute("""
        SELECT count(*) FROM order_items i
        JOIN orders o ON o.id = i.order_id
        JOIN products p ON p.id = i.product_id
        WHERE o.created_at >= %s AND i.unit_price <> p.price
    """, [seed.REPRICE_DATE]).fetchone()[0]
    assert stale == 0


# --- scenario data other tests and exercises rely on ---------------------------

def test_repriced_products_keep_old_prices_in_history(conn, seeded):
    repriced = conn.execute("""
        SELECT count(DISTINCT p.id) FROM products p
        JOIN order_items i ON i.product_id = p.id
        WHERE i.unit_price < p.price
    """).fetchone()[0]
    assert repriced == seed.N_REPRICED


def test_limited_product_has_exactly_two_available(conn, seeded):
    on_hand, reserved = conn.execute("""
        SELECT v.on_hand, v.reserved FROM inventory v
        JOIN products p ON p.id = v.product_id WHERE p.sku = %s
    """, [seed.LIMITED_SKU]).fetchone()
    assert (on_hand, reserved) == (2, 0)


def test_every_order_state_is_represented(conn, seeded):
    statuses = {row[0] for row in conn.execute("SELECT DISTINCT status FROM orders")}
    payment_statuses = {row[0] for row in conn.execute("SELECT DISTINCT status FROM payments")}
    assert statuses == {"pending", "paid", "fulfilled", "cancelled"}
    assert {"succeeded", "failed", "unknown"} <= payment_statuses


# --- catalogue content ----------------------------------------------------------

def _active(conn):
    return conn.execute("SELECT sku, category, brand FROM products WHERE active").fetchall()


def test_54_active_products_9_per_category_plus_one_discontinued(conn, seeded):
    rows = conn.execute(
        "SELECT category, count(*) FROM products WHERE active GROUP BY category").fetchall()
    assert len(rows) == 6 and {n for _, n in rows} == {9}
    assert conn.execute("SELECT count(*) FROM products").fetchone()[0] == 55


def test_every_category_has_at_least_two_active_brands(conn, seeded):
    rows = conn.execute("""SELECT category, count(DISTINCT brand) FROM products
                           WHERE active GROUP BY category""").fetchall()
    assert len(rows) == 6 and all(n >= 2 for _, n in rows)


def test_every_product_has_content(conn, seeded):
    rows = conn.execute("SELECT sku, category, description, specs, price FROM products").fetchall()
    assert len(rows) == 55
    for sku, category, description, specs, price in rows:
        assert description.strip(), sku
        assert 3 <= len(specs) <= 5, sku
        labels = [s["label"] for s in specs]
        assert all(s["label"].strip() and s["value"].strip() for s in specs), sku
        assert set(labels) <= set(LABELS[category]), sku
        assert sku in CONTENT


def test_prices_are_in_range_and_spread_within_categories(conn, seeded):
    for category in LABELS:
        prices = {r[0] for r in conn.execute(
            "SELECT price FROM products WHERE category = %s", [category])}
        assert len(prices) >= 6, category
    low, high = conn.execute("SELECT min(price), max(price) FROM products").fetchone()
    assert low >= 9 and high <= 499
    # The seed reprices a few products by 10% after the content prices are set.
    for sku, expected in [(seed.catalogue_data.SPOTLIGHT_SKU, "119.00"),
                          (seed.LIMITED_SKU, "149.00"), (seed.SOLD_OUT_SKU, "64.00")]:
        got = conn.execute("SELECT price FROM products WHERE sku = %s", [sku]).fetchone()[0]
        assert str(got) == expected


def test_spotlight_tagline(conn, seeded):
    tagline = conn.execute("SELECT tagline FROM products WHERE sku = %s",
                           [catalogue_data.SPOTLIGHT_SKU]).fetchone()[0]
    assert tagline == "Quiet keys. Three devices. One cable."


def test_sold_out_product_has_nothing_on_hand(conn, seeded):
    on_hand, moves = conn.execute("""
        SELECT v.on_hand, (SELECT count(*) FROM stock_movements m WHERE m.product_id = v.product_id)
        FROM inventory v JOIN products p ON p.id = v.product_id WHERE p.sku = %s
    """, [seed.SOLD_OUT_SKU]).fetchone()
    assert (on_hand, moves) == (0, 0)


def test_low_stock_products_have_five_or_fewer(conn, seeded):
    rows = conn.execute("""
        SELECT p.sku, v.on_hand - v.reserved FROM inventory v
        JOIN products p ON p.id = v.product_id WHERE p.sku = ANY(%s)
    """, [list(seed.LOW_STOCK_SKUS)]).fetchall()
    assert dict(rows) == {seed.LOW_STOCK_SKUS[0]: 4, seed.LOW_STOCK_SKUS[1]: 5}


def test_scenario_products_are_never_ordered(conn, seeded):
    skus = [seed.LIMITED_SKU, seed.SOLD_OUT_SKU, *seed.LOW_STOCK_SKUS]
    n = conn.execute("SELECT count(*) FROM order_items WHERE sku = ANY(%s)", [skus]).fetchone()[0]
    assert n == 0


def test_discontinued_product_is_inactive(conn, seeded):
    active = conn.execute("SELECT active FROM products WHERE sku = %s",
                          [catalogue_data.DISCONTINUED_SKU]).fetchone()[0]
    assert active is False


def test_collections_only_contain_active_products(conn, seeded):
    n = conn.execute("""SELECT count(*) FROM collection_products cp
                        JOIN products p ON p.id = cp.product_id WHERE NOT p.active""").fetchone()[0]
    assert n == 0
    slugs = [r[0] for r in conn.execute("SELECT slug FROM collections ORDER BY position")]
    assert slugs == [c[0] for c in catalogue_data.COLLECTIONS]


def test_spotlight_has_exactly_one_product(conn, seeded):
    rows = conn.execute("""SELECT p.sku FROM collection_products cp
        JOIN collections c ON c.id = cp.collection_id JOIN products p ON p.id = cp.product_id
        WHERE c.slug = 'spotlight'""").fetchall()
    assert rows == [(catalogue_data.SPOTLIGHT_SKU,)]


def test_featured_includes_the_limited_product(conn, seeded):
    skus = {r[0] for r in conn.execute("""SELECT p.sku FROM collection_products cp
        JOIN collections c ON c.id = cp.collection_id JOIN products p ON p.id = cp.product_id
        WHERE c.slug = 'featured'""")}
    assert seed.LIMITED_SKU in skus


def test_order_items_carry_the_product_name_and_sku(conn, seeded):
    bad = conn.execute("""SELECT count(*) FROM order_items i JOIN products p ON p.id = i.product_id
                          WHERE i.product_name <> p.name OR i.sku <> p.sku""").fetchone()[0]
    assert bad == 0


def test_brands_are_the_invented_set(conn, seeded):
    brands = {r[0] for r in conn.execute("SELECT DISTINCT brand FROM products")}
    assert brands == {"Halden", "Marlow", "Tessel", "Kestrel", "Aster", "Orrin", "Lumi", "Corda"}


def test_product_images_match_the_manifest(conn, seeded):
    manifest = image_manifest.load_manifest()
    rows = conn.execute("""SELECT p.slug, pi.position, pi.alt FROM product_images pi
                           JOIN products p ON p.id = pi.product_id
                           ORDER BY p.slug, pi.position""").fetchall()
    expected = sorted((slug, img.position, img.alt)
                      for slug, images in manifest.items() for img in images)
    assert rows == expected


def test_placeholder_image_keys_match_their_bytes(conn, seeded):
    for sha, data in conn.execute("SELECT sha256, data FROM images"):
        assert sha == hashlib.sha256(bytes(data)).hexdigest()
        assert bytes(data).startswith(b"placeholder:")
    orphans = conn.execute("""SELECT count(*) FROM product_images pi
        WHERE NOT EXISTS (SELECT 1 FROM images i WHERE i.sha256 = pi.image_sha256)""").fetchone()[0]
    assert orphans == 0


def test_real_image_bytes_keep_the_manifest_key(conn, monkeypatch):
    """With an image_bytes callable the manifest's key is kept as it is."""
    blob = b"\xff\xd8 a real jpeg, honest"
    sha = hashlib.sha256(blob).hexdigest()
    slug = catalogue_data.PRODUCTS[0][1]
    entry = image_manifest.ManifestImage(
        position=1, sha256=sha, content_type="image/jpeg", download_url="https://x/y.jpg",
        source_url="https://x/y", licence="Unsplash License", credit="A. Photographer",
        alt="alt text")
    monkeypatch.setattr(image_manifest, "load_manifest", lambda: {slug: [entry]})
    seed.write(conn, *seed.generate(42), image_bytes=lambda key: blob)
    assert conn.execute("SELECT sha256, data FROM images").fetchall() == [(sha, blob)]
    assert conn.execute("SELECT image_sha256 FROM product_images").fetchall() == [(sha,)]

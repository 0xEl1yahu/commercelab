"""Product discovery for the storefront. Read-only: nothing here writes.

Every function takes a psycopg connection instead of opening its own, so a
route can pass in a pooled connection and a test can pass in one that is
rolled back afterwards.

Rules this module owns:
  - the storefront only ever sees active products
  - unit_cost (internal margin data) is never selected
  - product responses show stock as a band (in stock / only N left / out of
    stock), never the raw available count: stock_band() is the one place that
    decides it. (The 409 stock error and the cart quote do reveal how many can
    be bought, up to 100, by design.)

Rules it does NOT own:
  - what "available" means: that is the product_availability view in db.sql,
    owned by inventory. This module only reads it.
  - VAT: pricing.vat_included.
"""

from collections.abc import Sequence
from decimal import Decimal
from typing import Literal, TypedDict

import psycopg
from psycopg.rows import dict_row

from commercelab.domain import pricing

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100

# 1 to LOW_STOCK_THRESHOLD available shows "Only N left".
LOW_STOCK_THRESHOLD = 5

StockStatus = Literal["in_stock", "low_stock", "out_of_stock"]
Sort = Literal["featured", "name", "price_asc", "price_desc"]


def stock_band(available: int) -> tuple[StockStatus, int | None]:
    """(stock_status, stock_left). stock_left is set only for low stock.

    0 -> ("out_of_stock", None), 1-5 -> ("low_stock", n), 6+ -> ("in_stock", None).
    """
    if available <= 0:
        return "out_of_stock", None
    if available <= LOW_STOCK_THRESHOLD:
        return "low_stock", available
    return "in_stock", None


# --- shapes -------------------------------------------------------------------------

class Image(TypedDict):
    key: str  # sha256 of the bytes; served at GET /images/{key}
    alt: str


class ProductCard(TypedDict):
    """A product as listings, collections and the cart show it."""

    id: int
    slug: str
    sku: str
    name: str
    brand: str
    category: str
    price: Decimal
    stock_status: StockStatus
    stock_left: int | None
    image: Image | None  # the primary image (position 1), if any


class Spec(TypedDict):
    label: str
    value: str


class ProductDetail(ProductCard):
    """A product as its own page shows it."""

    category_title: str
    tagline: str
    description: str
    specs: list[Spec]
    images: list[Image]  # every image, in position order
    vat_included: Decimal


class ProductListing(TypedDict):
    items: list[ProductCard]
    total: int  # every match, not just this page


class Facets(TypedDict):
    """What the filter bar offers for one category (or the whole catalogue)."""

    brands: list[str]
    min_price: Decimal | None  # None when there are no active products
    max_price: Decimal | None


class Category(TypedDict):
    slug: str
    title: str
    description: str


class Collection(TypedDict):
    slug: str
    title: str
    description: str


class CollectionDetail(Collection):
    products: list[ProductCard]


# --- errors -------------------------------------------------------------------------

class ProductNotFound(Exception):
    """No active product has this id (int) or slug (str). The route layer gives 404."""

    def __init__(self, ref: int | str):
        if isinstance(ref, int):
            message = f"No active product with id {ref}"
        else:
            message = f"No active product {ref!r}"
        super().__init__(message)
        self.ref = ref


class CollectionNotFound(Exception):
    """No collection has this slug. The route layer gives 404."""

    def __init__(self, slug: str):
        super().__init__(f"No collection {slug!r}")
        self.slug = slug


# --- the shared product query ----------------------------------------------------------

# Shared by every product query, so the active filter and the column list
# (which deliberately leaves out unit_cost) cannot drift between functions.
# Callers append "AND ..." conditions and ORDER BY / LIMIT, or wrap it as a
# subquery (every column it needs to sort on is selected).
#   LEFT JOIN + coalesce: a product with no inventory row shows 0 available
#     instead of disappearing from the storefront.
#   LEFT JOIN product_images at position 1: the card's primary image, or NULL.
# `available` is selected for sorting and banding only; _card() turns it into
# a stock band, and it never leaves this module.
_PRODUCT_QUERY = """
    SELECT p.id, p.slug, p.sku, p.name, p.brand, p.category, p.price, p.created_at,
           coalesce(a.available, 0) AS available,
           pi.image_sha256 AS image_key, pi.alt AS image_alt
    FROM products p
    LEFT JOIN product_availability a ON a.product_id = p.id
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.position = 1
    WHERE p.active
"""


def _card(row: dict) -> ProductCard:
    """A _PRODUCT_QUERY row (dict_row) as a ProductCard: banded stock, no raw count."""
    stock_status, stock_left = stock_band(row["available"])
    image: Image | None = None
    if row["image_key"] is not None:
        image = {"key": row["image_key"], "alt": row["image_alt"]}
    return {
        "id": row["id"],
        "slug": row["slug"],
        "sku": row["sku"],
        "name": row["name"],
        "brand": row["brand"],
        "category": row["category"],
        "price": row["price"],
        "stock_status": stock_status,
        "stock_left": stock_left,
        "image": image,
    }


# --- categories ---------------------------------------------------------------------

def list_categories(conn: psycopg.Connection) -> list[Category]:
    """Categories with at least one active product, in nav order (position, then slug)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT c.slug, c.title, c.description
            FROM categories c
            WHERE EXISTS (SELECT 1 FROM products p WHERE p.category = c.slug AND p.active)
            ORDER BY c.position, c.slug COLLATE "C"
            """
        )
        return cur.fetchall()


# --- products ---------------------------------------------------------------------

# Every sort ends in the id, and names compare as lower(name COLLATE "C"), so the
# order never depends on the database's locale and paging never repeats or skips.
_NAME_ORDER = 'lower(q.name COLLATE "C"), q.id'
_MAX_OFFSET = 2**63 - 1  # PostgreSQL bigint
_ORDER_BY = {
    # In stock first, newest first, then the name order.
    "featured": f"(q.available = 0), q.created_at DESC, {_NAME_ORDER}",
    "name": _NAME_ORDER,
    "price_asc": f"q.price, {_NAME_ORDER}",
    "price_desc": f"q.price DESC, {_NAME_ORDER}",
}


def list_products(
    conn: psycopg.Connection,
    *,
    category: str | None = None,
    brands: Sequence[str] = (),
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
    in_stock: bool = False,
    sort: Sort = "featured",
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
) -> ProductListing:
    """One page of active products matching the filters, and the total match count.

    Raises ValueError for bad paging, or when min_price > max_price.
    """
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}, not {limit}")
    if offset < 0:
        raise ValueError(f"offset must not be negative, not {offset}")
    if min_price is not None and max_price is not None and min_price > max_price:
        raise ValueError("min_price must not exceed max_price")
    if sort not in _ORDER_BY:
        raise ValueError(f"unknown sort {sort!r}: expected one of {', '.join(_ORDER_BY)}")

    # Values always travel as parameters; only the fixed fragments below are SQL text.
    query = _PRODUCT_QUERY
    params: list = []
    if category is not None:
        query += " AND p.category = %s"
        params.append(category)
    if brands:
        query += " AND p.brand = ANY(%s)"
        params.append(list(brands))
    if min_price is not None:
        query += " AND p.price >= %s"
        params.append(min_price)
    if max_price is not None:
        query += " AND p.price <= %s"
        params.append(max_price)
    if in_stock:
        query += " AND coalesce(a.available, 0) > 0"

    with conn.cursor(row_factory=dict_row) as cur:
        if offset > _MAX_OFFSET:
            # Beyond what OFFSET accepts (a bigint): certainly past the end.
            cur.execute(f"SELECT count(*) AS total FROM ({query}) q", params)
            return {"items": [], "total": cur.fetchone()["total"]}
        cur.execute(
            f"SELECT q.*, count(*) OVER () AS total FROM ({query}) q "
            f"ORDER BY {_ORDER_BY[sort]} LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
        rows = cur.fetchall()
        if rows:
            total = rows[0]["total"]
        elif offset == 0:
            total = 0
        else:
            # An offset past the end returns no rows to carry the window count.
            cur.execute(f"SELECT count(*) AS total FROM ({query}) q", params)
            total = cur.fetchone()["total"]
    return {"items": [_card(row) for row in rows], "total": total}


def listing_facets(conn: psycopg.Connection, *, category: str | None) -> Facets:
    """Brands (alphabetical) and the price range of the active products in a category."""
    query = _PRODUCT_QUERY
    params: list = []
    if category is not None:
        query += " AND p.category = %s"
        params.append(category)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT coalesce(array_agg(DISTINCT q.brand), '{}') AS brands, "
            f"min(q.price) AS min_price, max(q.price) AS max_price FROM ({query}) q",
            params,
        )
        row = cur.fetchone()
    # Sorted here, not in SQL, so the order never depends on the database's locale:
    # case-insensitive, with the exact spelling as the tie-break.
    return {
        "brands": sorted(row["brands"], key=lambda brand: (brand.lower(), brand)),
        "min_price": row["min_price"],
        "max_price": row["max_price"],
    }


def get_product(conn: psycopg.Connection, product_id: int) -> ProductCard:
    """One active product by id. Inactive and missing products raise ProductNotFound."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_PRODUCT_QUERY + " AND p.id = %s", [product_id])
        row = cur.fetchone()
    if row is None:
        raise ProductNotFound(product_id)
    return _card(row)


def get_product_by_slug(conn: psycopg.Connection, slug: str) -> ProductDetail:
    """One active product by slug, with everything its page shows. Raises ProductNotFound."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT q.*, p.tagline, p.description, p.specs, c.title AS category_title "
            f"FROM ({_PRODUCT_QUERY} AND p.slug = %s) q "
            "JOIN products p ON p.id = q.id "
            "JOIN categories c ON c.slug = q.category",
            [slug],
        )
        row = cur.fetchone()
        if row is None:
            raise ProductNotFound(slug)
        cur.execute(
            "SELECT image_sha256 AS key, alt FROM product_images "
            "WHERE product_id = %s ORDER BY position",
            [row["id"]],
        )
        images: list[Image] = cur.fetchall()
    card = _card(row)
    return {
        **card,
        "category_title": row["category_title"],
        "tagline": row["tagline"],
        "description": row["description"],
        "specs": [{"label": spec["label"], "value": spec["value"]} for spec in row["specs"]],
        "images": images,
        "vat_included": pricing.vat_included(card["price"]),
    }


# --- collections ----------------------------------------------------------------------

def list_collections(conn: psycopg.Connection) -> list[Collection]:
    """Every collection, by position."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT slug, title, description FROM collections "
            'ORDER BY position, slug COLLATE "C"'
        )
        return cur.fetchall()


def get_collection(conn: psycopg.Connection, slug: str) -> CollectionDetail:
    """One collection with its active products in collection order. Raises CollectionNotFound."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, slug, title, description FROM collections WHERE slug = %s", [slug]
        )
        collection = cur.fetchone()
        if collection is None:
            raise CollectionNotFound(slug)
        cur.execute(
            f"SELECT q.* FROM ({_PRODUCT_QUERY}) q "
            "JOIN collection_products cp ON cp.product_id = q.id "
            "WHERE cp.collection_id = %s ORDER BY cp.position, q.id",
            [collection["id"]],
        )
        rows = cur.fetchall()
    return {
        "slug": collection["slug"],
        "title": collection["title"],
        "description": collection["description"],
        "products": [_card(row) for row in rows],
    }

"""Product discovery for the storefront. Read-only: nothing here writes.

Every function takes a psycopg connection instead of opening its own, so a
route can pass in a pooled connection and a test can pass in one that is
rolled back afterwards.

Rules this module owns:
  - the storefront only ever sees active products
  - unit_cost (internal margin data) is never selected
  - stock is shown as a band (in stock / only N left / out of stock), never as
    the raw available count: stock_band() is the one place that decides it

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


# --- products (stream b-catalogue implements these) -----------------------------------

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
    raise NotImplementedError("b-catalogue")


def listing_facets(conn: psycopg.Connection, *, category: str | None) -> Facets:
    """Brands (alphabetical) and the price range of the active products in a category."""
    raise NotImplementedError("b-catalogue")


def get_product(conn: psycopg.Connection, product_id: int) -> ProductCard:
    """One active product by id. Inactive and missing products raise ProductNotFound."""
    raise NotImplementedError("b-catalogue")


def get_product_by_slug(conn: psycopg.Connection, slug: str) -> ProductDetail:
    """One active product by slug, with everything its page shows. Raises ProductNotFound."""
    raise NotImplementedError("b-catalogue")


def list_collections(conn: psycopg.Connection) -> list[Collection]:
    """Every collection, by position."""
    raise NotImplementedError("b-catalogue")


def get_collection(conn: psycopg.Connection, slug: str) -> CollectionDetail:
    """One collection with its active products in collection order. Raises CollectionNotFound."""
    raise NotImplementedError("b-catalogue")


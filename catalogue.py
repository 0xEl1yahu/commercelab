"""Product discovery for the storefront. Read-only: nothing here writes.

Every function takes a psycopg connection instead of opening its own, so a
route can pass in a pooled connection and a test can pass in one that is
rolled back afterwards.

Rules this module owns:
  - the storefront only ever sees active products
  - unit_cost (internal margin data) is never selected

Rules it does NOT own:
  - what "available" means: that is the product_availability view in db.sql,
    owned by inventory. This module only reads it.
"""

from decimal import Decimal
from typing import TypedDict

import psycopg
from psycopg.rows import dict_row

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


class Product(TypedDict):
    id: int
    sku: str
    name: str
    category: str
    price: Decimal
    available: int


class ProductNotFound(Exception):
    """No active product has this id. The route layer turns this into a 404."""

    def __init__(self, product_id: int):
        super().__init__(f"No active product with id {product_id}")
        self.product_id = product_id


# Shared by every product query, so the active filter and the column list
# (which deliberately leaves out unit_cost) cannot drift between functions.
# LEFT JOIN + coalesce: a product with no inventory row shows 0 available
# instead of disappearing from the storefront.
_PRODUCT_QUERY = """
    SELECT p.id, p.sku, p.name, p.category, p.price,
           coalesce(a.available, 0) AS available
    FROM products p
    LEFT JOIN product_availability a ON a.product_id = p.id
    WHERE p.active
"""


def list_products(
    conn: psycopg.Connection,
    *,
    category: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
) -> list[Product]:
    """One page of active products, sorted by name (case-insensitive), then id.

    Out-of-stock products are included with available = 0, so the storefront
    can show "sold out" rather than silently hiding them.

    The sort is spelled out as lower(name) COLLATE "C" so it is the same on every
    server: a plain ORDER BY name follows the database's locale, and two
    databases with different locales would page through products differently.
    id is the tie-breaker that makes the order total, so pages never overlap.
    """
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}, got {limit}")
    if offset < 0:
        raise ValueError(f"offset must not be negative, got {offset}")

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            _PRODUCT_QUERY
            + """
              AND (%(category)s::text IS NULL OR p.category = %(category)s)
            ORDER BY lower(p.name) COLLATE "C", p.id
            LIMIT %(limit)s OFFSET %(offset)s
            """,
            {"category": category, "limit": limit, "offset": offset},
        )
        return cur.fetchall()


def get_product(conn: psycopg.Connection, product_id: int) -> Product:
    """One active product. Inactive and missing products both raise ProductNotFound."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_PRODUCT_QUERY + " AND p.id = %(id)s", {"id": product_id})
        product = cur.fetchone()
    if product is None:
        raise ProductNotFound(product_id)
    return product


def list_categories(conn: psycopg.Connection) -> list[str]:
    """Categories that have at least one active product, alphabetically."""
    rows = conn.execute(
        "SELECT DISTINCT category FROM products WHERE active ORDER BY category"
    ).fetchall()
    return [category for (category,) in rows]

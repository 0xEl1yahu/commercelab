"""The cart quote: what the browser's cart costs right now. Read-only.

The cart itself lives in the browser as (product_id, quantity) lines. Every
number the shopper sees comes from quote(): current prices, line totals, how
much can actually be bought, VAT and the total. Nothing is reserved; checkout
does that.
"""

from collections.abc import Iterable
from decimal import Decimal
from typing import TypedDict

import psycopg

from commercelab.domain.catalogue import ProductCard

# The most of one product a single order line may hold (checkout enforces it too).
MAX_LINE_QUANTITY = 100


class QuoteLine(TypedDict):
    product: ProductCard
    requested: int       # what the cart asked for (repeated ids merged)
    quantity: int        # min(requested, available, MAX_LINE_QUANTITY); 0 when sold out
    limited: bool        # quantity < requested
    line_total: Decimal  # quantity × current price


class Quote(TypedDict):
    lines: list[QuoteLine]
    removed: list[int]   # unknown or inactive product ids, sorted
    subtotal: Decimal
    delivery: Decimal
    total: Decimal
    vat_included: Decimal


def quote(conn: psycopg.Connection, items: Iterable[tuple[int, int]]) -> Quote:
    """Price the cart lines (product_id, quantity) against the database.

    Repeated ids are merged, keeping first-seen order. Quantities are clamped
    to what is available and to MAX_LINE_QUANTITY; unknown and inactive ids
    are dropped into `removed`. Reserves nothing.
    """
    raise NotImplementedError("b-cart")

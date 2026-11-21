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
from psycopg.rows import dict_row

from commercelab.domain import pricing
from commercelab.domain.catalogue import _PRODUCT_QUERY, ProductCard, _card

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
    requested: dict[int, int] = {}  # dicts keep first-seen order
    for product_id, quantity in items:
        requested[product_id] = requested.get(product_id, 0) + quantity

    rows: dict[int, dict] = {}
    if requested:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(_PRODUCT_QUERY + " AND p.id = ANY(%s)", [list(requested)])
            rows = {row["id"]: row for row in cur.fetchall()}

    lines: list[QuoteLine] = []
    subtotal = Decimal("0.00")
    for product_id, wanted in requested.items():
        row = rows.get(product_id)
        if row is None:
            continue
        card = _card(row)
        quantity = max(0, min(wanted, row["available"], MAX_LINE_QUANTITY))
        line_total = card["price"] * quantity
        subtotal += line_total
        lines.append(
            {
                "product": card,
                "requested": wanted,
                "quantity": quantity,
                "limited": quantity < wanted,
                "line_total": line_total,
            }
        )

    return {
        "lines": lines,
        "removed": sorted(pid for pid in requested if pid not in rows),
        "subtotal": subtotal,
        "delivery": pricing.STANDARD_DELIVERY,
        "total": subtotal + pricing.STANDARD_DELIVERY,
        "vat_included": pricing.vat_included(subtotal + pricing.STANDARD_DELIVERY),
    }

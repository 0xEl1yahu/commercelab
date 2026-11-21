"""API request/response schemas (Pydantic).

These define the public JSON contract. Domain modules return plain data;
routes convert it into these models, which also filters out any field not
declared here (a second guard, after catalogue.py, against leaking unit_cost).

Money is Decimal and serialises to a JSON *string* ("97.90"), never a float,
so the frontend must treat prices as strings or decimals, not numbers.
"""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    category: str
    price: Decimal = Field(description='GBP, tax-inclusive. Serialised as a string, e.g. "97.90".')
    available: int = Field(description="Units that can be ordered now (on hand minus reserved).")


class ProductPage(BaseModel):
    """One page of products. An envelope rather than a bare list, so paging
    metadata (and later a total or a next cursor) can be added without
    breaking clients."""

    items: list[ProductOut]
    limit: int
    offset: int


class Health(BaseModel):
    status: Literal["ok", "unavailable"]
    database: Literal["ok", "unreachable"]


class ErrorOut(BaseModel):
    detail: str

"""API request/response schemas (Pydantic).

These define the public JSON contract. The storefront's TypeScript types are
generated from them (via the committed openapi.json), so a change here is a
contract change: re-run `uv run python -m scripts.export_openapi`, which a test
enforces.

Domain modules return plain data; routes convert it into these models, which
also drops any field not declared here (a second guard, after the domain
modules, against leaking unit_cost, raw stock counts or internal ids).

Money is Decimal and serialises to a JSON *string* ("97.90"), never a float,
so the frontend must treat prices as strings, not numbers.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from commercelab.domain.cart import MAX_LINE_QUANTITY
from commercelab.domain.catalogue import StockStatus

GBP = 'GBP, tax-inclusive. Serialised as a string, e.g. "97.90".'

# --- catalogue ----------------------------------------------------------------------


class ImageOut(BaseModel):
    key: str = Field(description="sha256 of the bytes. The bytes are at GET /images/{key}.")
    alt: str


class ProductCardOut(BaseModel):
    """A product as listings, collections and the cart show it.

    Stock is a band, never a count: stock_left is set only for low_stock.
    """

    id: int
    slug: str
    sku: str
    name: str
    brand: str
    category: str
    price: Decimal = Field(description=GBP)
    stock_status: StockStatus
    stock_left: int | None = Field(description="Units left, only when stock_status is low_stock.")
    image: ImageOut | None = Field(description="The primary image, or null if there is none.")


class SpecOut(BaseModel):
    label: str
    value: str


class ProductDetailOut(ProductCardOut):
    """A product as its own page shows it."""

    category_title: str
    tagline: str
    description: str
    specs: list[SpecOut]
    images: list[ImageOut] = Field(description="Every image, in gallery order.")
    vat_included: Decimal = Field(description="The VAT inside price (price ÷ 6). " + GBP)


class FacetsOut(BaseModel):
    """What the filter bar offers for the listed category: never a brand with nothing in it."""

    brands: list[str]
    min_price: Decimal | None = Field(description="Null when the category has no products.")
    max_price: Decimal | None = Field(description="Null when the category has no products.")


class ProductPage(BaseModel):
    """One page of products. total counts every match, not just this page."""

    items: list[ProductCardOut]
    total: int
    limit: int
    offset: int
    facets: FacetsOut


class CategoryOut(BaseModel):
    slug: str
    title: str
    description: str


class CollectionOut(BaseModel):
    slug: str
    title: str
    description: str


class CollectionDetailOut(CollectionOut):
    products: list[ProductCardOut]


# --- cart quote ---------------------------------------------------------------------


class QuoteItem(BaseModel):
    product_id: int
    # Far above MAX_LINE_QUANTITY on purpose: a stale or oversized cart is
    # clamped by the quote (limited: true), not rejected with a 422.
    quantity: int = Field(gt=0, le=10_000)


class CartQuoteRequest(BaseModel):
    items: list[QuoteItem] = Field(default_factory=list, max_length=200)


class CartLineOut(BaseModel):
    product: ProductCardOut
    requested: int = Field(description="What the cart asked for, repeated ids merged.")
    quantity: int = Field(
        description="What can be bought: at most what is available and "
        f"{MAX_LINE_QUANTITY} per line. 0 when sold out."
    )
    limited: bool = Field(description="quantity < requested.")
    line_total: Decimal = Field(description=GBP)


class CartQuoteOut(BaseModel):
    lines: list[CartLineOut]
    removed: list[int] = Field(description="Product ids that are unknown or no longer sold.")
    subtotal: Decimal
    delivery: Decimal
    total: Decimal
    vat_included: Decimal


# --- checkout -----------------------------------------------------------------------


class CheckoutItem(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=MAX_LINE_QUANTITY)


class ContactIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r"^[0-9 +()-]{7,20}$")


class AddressIn(BaseModel):
    """The delivery address. The recipient's name and phone come from the contact."""

    model_config = ConfigDict(str_strip_whitespace=True)

    line1: str = Field(min_length=1, max_length=100)
    line2: str | None = Field(default=None, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    postcode: str = Field(pattern=r"^[A-Za-z0-9 ]{5,8}$")
    company: str | None = Field(default=None, max_length=100)
    vat_number: str | None = Field(default=None, max_length=100)
    country: Literal["GB"] = "GB"

    @field_validator("line2", "company", "vat_number", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        """An empty optional field (as a form sends it) means "not given"."""
        if isinstance(value, str) and not value.strip():
            return None
        return value


class CheckoutRequest(BaseModel):
    """No prices and no card details: the server takes prices from the database,
    and the simulated provider takes only an amount."""

    contact: ContactIn
    address: AddressIn
    items: list[CheckoutItem] = Field(min_length=1, max_length=50)


# --- orders -------------------------------------------------------------------------


class OrderItemOut(BaseModel):
    product_id: int
    sku: str = Field(description="As it was when the order was placed.")
    product_name: str = Field(description="As it was when the order was placed.")
    quantity: int
    unit_price: Decimal = Field(description="As it was when the order was placed. " + GBP)
    line_total: Decimal


class AddressOut(BaseModel):
    name: str
    phone: str
    company: str | None
    vat_number: str | None
    line1: str
    line2: str | None
    city: str
    postcode: str
    country: Literal["GB"]


class OrderOut(BaseModel):
    """An order as its customer sees it, reached only by its token.

    No internal id, no customer id and no unit costs.
    """

    reference: str = Field(description='What the customer quotes, e.g. "CL-01501".')
    token: str = Field(description="The unguessable id in the order's link: GET /orders/{token}.")
    status: Literal["pending", "paid", "fulfilled", "cancelled"]
    payment_status: Literal["pending", "succeeded", "failed", "unknown"] | None
    created_at: datetime
    customer_name: str
    items: list[OrderItemOut]
    subtotal: Decimal
    delivery: Decimal
    total: Decimal
    vat_included: Decimal
    address: AddressOut | None = Field(description="Null for orders placed without one.")


# --- errors and health --------------------------------------------------------------


class InsufficientStockOut(BaseModel):
    detail: str
    product_id: int
    requested: int
    available: int


class Health(BaseModel):
    status: Literal["ok", "unavailable"]
    database: Literal["ok", "unreachable"]


class ErrorOut(BaseModel):
    detail: str

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from commercelab.api.dependencies import Conn
from commercelab.api.models import (
    ERROR_OR_VALIDATION,
    CategoryOut,
    ErrorOut,
    ProductCardOut,
    ProductDetailOut,
    ProductPage,
)
from commercelab.domain import catalogue

router = APIRouter(tags=["catalogue"])


@router.get("/products", responses={422: ERROR_OR_VALIDATION})
def list_products(
    conn: Conn,
    *,
    category: str | None = None,
    brand: Annotated[
        list[str], Query(default_factory=list, description="Repeatable: ?brand=Halden&brand=Marlow")
    ],
    min_price: Annotated[Decimal | None, Query(ge=0)] = None,
    max_price: Annotated[Decimal | None, Query(ge=0)] = None,
    in_stock: bool = False,
    sort: catalogue.Sort = "featured",
    limit: Annotated[int, Query(ge=1, le=catalogue.MAX_PAGE_SIZE)] = catalogue.DEFAULT_PAGE_SIZE,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProductPage:
    """One page of active products, the total match count, and the filter bar's facets.

    An offset past the end is a 200 with no items and the true total.
    """
    # Query(...) rejects bad values with a 422 before this runs, so catalogue's
    # own ValueError checks are a second line of defence.
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price must not exceed max_price")
    listing = catalogue.list_products(
        conn, category=category, brands=brand, min_price=min_price, max_price=max_price,
        in_stock=in_stock, sort=sort, limit=limit, offset=offset,
    )
    facets = catalogue.listing_facets(conn, category=category)
    return ProductPage(
        items=listing["items"], total=listing["total"], limit=limit, offset=offset, facets=facets
    )


# Declared before /products/{product_id}, so "by-slug" is never read as an id.
@router.get("/products/by-slug/{slug}", responses={404: {"model": ErrorOut}})
def get_product_by_slug(conn: Conn, slug: str) -> ProductDetailOut:
    return ProductDetailOut(**catalogue.get_product_by_slug(conn, slug))


@router.get("/products/{product_id}", responses={404: {"model": ErrorOut}})
def get_product(conn: Conn, product_id: int) -> ProductCardOut:
    return ProductCardOut(**catalogue.get_product(conn, product_id))


@router.get("/categories")
def list_categories(conn: Conn) -> list[CategoryOut]:
    """Categories with at least one active product, in nav order."""
    return [CategoryOut(**category) for category in catalogue.list_categories(conn)]

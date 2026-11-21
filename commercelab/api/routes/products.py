from typing import Annotated

from fastapi import APIRouter, Query

from commercelab.api.dependencies import Conn
from commercelab.api.models import ErrorOut, ProductOut, ProductPage
from commercelab.domain import catalogue

router = APIRouter(tags=["catalogue"])


@router.get("/products")
def list_products(
    conn: Conn,
    category: str | None = None,
    limit: Annotated[int, Query(ge=1, le=catalogue.MAX_PAGE_SIZE)] = catalogue.DEFAULT_PAGE_SIZE,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProductPage:
    # Query(ge=..., le=...) rejects bad paging with a 422 before this runs,
    # so catalogue's own ValueError checks are a second line of defence.
    products = catalogue.list_products(conn, category=category, limit=limit, offset=offset)
    return ProductPage(items=products, limit=limit, offset=offset)


@router.get("/products/{product_id}", responses={404: {"model": ErrorOut}})
def get_product(conn: Conn, product_id: int) -> ProductOut:
    return ProductOut(**catalogue.get_product(conn, product_id))


@router.get("/categories")
def list_categories(conn: Conn) -> list[str]:
    return catalogue.list_categories(conn)

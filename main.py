"""CommerceLab API entry point. Deliberately thin.

This file wires things together and nothing more:
  - opens the connection pool at startup and closes it at shutdown
  - maps domain exceptions to HTTP responses
  - declares routes, each of which validates input, calls one domain
    function, and converts the result into a response model

No SQL and no business rules live here. If a route grows logic beyond that,
the logic belongs in the module that owns it (catalogue.py, orders.py, ...).

Run locally:   uv run uvicorn main:app --reload
API docs:      http://127.0.0.1:8000/docs
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import psycopg
from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.responses import JSONResponse

import catalogue
from data import db
from models import ErrorOut, Health, ProductOut, ProductPage


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Everything before `yield` runs once at startup, everything after at shutdown.
    db.open_pool()
    try:
        yield
    finally:
        db.close_pool()


app = FastAPI(title="CommerceLab", version="0.1.0", lifespan=lifespan)

# A route parameter of this type receives one pooled connection per request.
Conn = Annotated[psycopg.Connection, Depends(db.get_conn)]


@app.exception_handler(catalogue.ProductNotFound)
def product_not_found(request: Request, exc: catalogue.ProductNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.get("/health")
def health(response: Response) -> Health:
    """Liveness plus a database check. 503 if Postgres can't be reached.

    Uses the pool directly instead of the Conn dependency: if no connection
    can be borrowed, the dependency itself would fail with a generic 500.
    """
    try:
        with db.connection() as conn:
            db.ping(conn)
    except psycopg.Error:  # includes PoolTimeout: no connection available in time
        response.status_code = 503
        return Health(status="unavailable", database="unreachable")
    return Health(status="ok", database="ok")


@app.get("/products")
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


@app.get("/products/{product_id}", responses={404: {"model": ErrorOut}})
def get_product(conn: Conn, product_id: int) -> ProductOut:
    return ProductOut(**catalogue.get_product(conn, product_id))


@app.get("/categories")
def list_categories(conn: Conn) -> list[str]:
    return catalogue.list_categories(conn)

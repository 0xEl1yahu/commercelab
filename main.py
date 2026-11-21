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
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

import catalogue
import inventory
import orders
import payments
from config import settings
from data import db
from models import (
    CheckoutRequest,
    ErrorOut,
    Health,
    InsufficientStockOut,
    OrderOut,
    ProductOut,
    ProductPage,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Everything before `yield` runs once at startup, everything after at shutdown.
    db.open_pool()
    try:
        yield
    finally:
        db.close_pool()


app = FastAPI(title="CommerceLab", version="0.1.0", lifespan=lifespan)

def get_payment_provider() -> payments.PaymentProvider:
    """The payment provider for this environment. Tests override this dependency.

    Principle 9 (demo/live separation): the simulated provider only exists in
    demo. There is no live provider yet, so live checkout refuses to run.
    """
    if settings.app_env != "demo":
        raise HTTPException(status_code=503, detail="No live payment provider is configured")
    return payments.SimulatedProvider()


# A route parameter of this type receives one pooled connection per request.
Conn = Annotated[psycopg.Connection, Depends(db.get_conn)]
Provider = Annotated[payments.PaymentProvider, Depends(get_payment_provider)]


# --- domain exceptions -> HTTP --------------------------------------------------------
# 404: the thing in the URL doesn't exist. 409: the request conflicts with the
# current state (stock, an earlier request). 422: the body refers to something invalid.

_STATUS_FOR = {
    catalogue.ProductNotFound: 404,
    orders.OrderNotFound: 404,
    orders.IdempotencyConflict: 409,
    orders.ProductUnavailable: 422,
    orders.CustomerNotFound: 422,
}


def _as_json_error(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=_STATUS_FOR[type(exc)], content={"detail": str(exc)})


for _exception_type in _STATUS_FOR:
    app.add_exception_handler(_exception_type, _as_json_error)


@app.exception_handler(inventory.InsufficientStock)
def insufficient_stock(request: Request, exc: inventory.InsufficientStock) -> JSONResponse:
    # Structured, so the storefront can say "only 2 left" without parsing text.
    body = InsufficientStockOut(
        detail=str(exc), product_id=exc.product_id,
        requested=exc.requested, available=exc.available,
    )
    return JSONResponse(status_code=409, content=body.model_dump())


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


@app.post(
    "/checkout",
    status_code=201,
    responses={
        200: {"model": OrderOut, "description": "A retry: the original order, unchanged"},
        409: {"model": InsufficientStockOut, "description": "Not enough stock, or key reused"},
        422: {"model": ErrorOut},
    },
)
def checkout(
    conn: Conn,
    provider: Provider,
    body: CheckoutRequest,
    response: Response,
    idempotency_key: Annotated[str, Header(min_length=1, max_length=255)],
) -> OrderOut:
    """Place and pay for an order.

    Send the same Idempotency-Key header when retrying (a timeout, a double
    click): the original order comes back with 200 and the customer is never
    charged twice. 201 means this request created the order. The order's
    status says how payment went: paid, cancelled (declined) or pending
    (outcome unknown; retry with the same key, or poll GET /orders/{id}).
    """
    result = orders.checkout(
        conn,
        provider,
        customer_id=body.customer_id,
        items=[(item.product_id, item.quantity) for item in body.items],
        idempotency_key=idempotency_key,
    )
    if not result.created:
        response.status_code = 200
    return OrderOut(**result.order)


@app.get("/orders/{order_id}", responses={404: {"model": ErrorOut}})
def get_order(conn: Conn, order_id: int) -> OrderOut:
    return OrderOut(**orders.get_order(conn, order_id))

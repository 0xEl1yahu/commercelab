"""Domain exceptions -> HTTP responses, in one place for the whole API.

Domain modules raise their own exceptions and know nothing about HTTP; this
module decides what each one means to a client:
  404  the thing in the URL doesn't exist
  409  the request conflicts with the current state (stock, an earlier request)
  422  the body refers to something invalid
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from commercelab.api.models import InsufficientStockOut
from commercelab.domain import catalogue, inventory, orders

STATUS_FOR = {
    catalogue.ProductNotFound: 404,
    orders.OrderNotFound: 404,
    orders.IdempotencyConflict: 409,
    orders.ProductUnavailable: 422,
    orders.CustomerNotFound: 422,
}


def _as_json_error(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=STATUS_FOR[type(exc)], content={"detail": str(exc)})


def _insufficient_stock(request: Request, exc: inventory.InsufficientStock) -> JSONResponse:
    # Structured, so the storefront can say "only 2 left" without parsing text.
    body = InsufficientStockOut(
        detail=str(exc),
        product_id=exc.product_id,
        requested=exc.requested,
        available=exc.available,
    )
    return JSONResponse(status_code=409, content=body.model_dump())


def register(app: FastAPI) -> None:
    for exception_type in STATUS_FOR:
        app.add_exception_handler(exception_type, _as_json_error)
    app.add_exception_handler(inventory.InsufficientStock, _insufficient_stock)

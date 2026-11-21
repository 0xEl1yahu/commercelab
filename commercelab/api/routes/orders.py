from typing import Annotated

from fastapi import APIRouter, Header, Response

from commercelab.api.dependencies import Conn, Provider
from commercelab.api.models import (
    CheckoutRequest,
    ErrorOut,
    InsufficientStockOut,
    OrderOut,
)
from commercelab.domain import orders

router = APIRouter(tags=["orders"])


@router.post(
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


@router.get("/orders/{order_id}", responses={404: {"model": ErrorOut}})
def get_order(conn: Conn, order_id: int) -> OrderOut:
    return OrderOut(**orders.get_order(conn, order_id))

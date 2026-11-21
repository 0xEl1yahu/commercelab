from typing import Annotated

from fastapi import APIRouter, Header, Response

from commercelab.api.dependencies import Conn, Provider
from commercelab.api.models import (
    ERROR_OR_VALIDATION,
    CheckoutRequest,
    ErrorOut,
    InsufficientStockOut,
    OrderOut,
)
from commercelab.domain import orders
from commercelab.domain.customers import Contact, DeliveryAddress

router = APIRouter(tags=["orders"])


@router.post(
    "/checkout",
    status_code=201,
    responses={
        200: {"model": OrderOut, "description": "A retry: the original order, unchanged"},
        409: {
            # InsufficientStockOut for stock; ErrorOut for a reused Idempotency-Key.
            "model": InsufficientStockOut | ErrorOut,
            "description": "Not enough stock (with the numbers), or the key was used for "
            "a different request",
        },
        422: ERROR_OR_VALIDATION,
    },
)
def checkout(
    conn: Conn,
    provider: Provider,
    body: CheckoutRequest,
    response: Response,
    idempotency_key: Annotated[str, Header(min_length=1, max_length=255)],
) -> OrderOut:
    """Place and pay for an order as a guest.

    Send the same Idempotency-Key header when retrying (a timeout, a double
    click): the original order comes back with 200 and the customer is never
    charged twice. 201 means this request created the order. The order's
    status says how payment went: paid, cancelled (declined; a new attempt
    needs a new key) or pending (outcome unknown; retry with the same key, or
    poll GET /orders/{token}).
    """
    contact = Contact(email=body.contact.email, name=body.contact.name, phone=body.contact.phone)
    # The recipient is the person checking out: the form has one name and phone.
    address = DeliveryAddress(
        name=body.contact.name,
        phone=body.contact.phone,
        line1=body.address.line1,
        line2=body.address.line2,
        city=body.address.city,
        postcode=body.address.postcode,
        company=body.address.company,
        vat_number=body.address.vat_number,
        country=body.address.country,
    )
    result = orders.guest_checkout(
        conn,
        provider,
        contact=contact,
        address=address,
        items=[(item.product_id, item.quantity) for item in body.items],
        idempotency_key=idempotency_key,
    )
    if not result.created:
        response.status_code = 200
    return OrderOut(**result.order)


@router.get("/orders/{token}", responses={404: {"model": ErrorOut}})
def get_order(conn: Conn, token: str) -> OrderOut:
    """An order by its unguessable token. There is no route by numeric id."""
    return OrderOut(**orders.get_order_by_token(conn, token))

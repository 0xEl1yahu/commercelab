from fastapi import APIRouter

from commercelab.api.dependencies import Conn
from commercelab.api.models import CartQuoteOut, CartQuoteRequest
from commercelab.domain import cart

router = APIRouter(tags=["cart"])


@router.post("/cart/quote")
def quote(conn: Conn, body: CartQuoteRequest) -> CartQuoteOut:
    """Price the browser's cart: current prices, clamped quantities, VAT and total.

    Never a 422 for a stale or oversized cart: unknown or discontinued ids come
    back in `removed`, and quantities above what can be bought are clamped
    (`limited: true`). Reserves nothing.
    """
    return CartQuoteOut(**cart.quote(conn, [(i.product_id, i.quantity) for i in body.items]))

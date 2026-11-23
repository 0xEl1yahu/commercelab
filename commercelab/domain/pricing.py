"""Money rules shared by the catalogue, the cart quote and orders.

Prices are GBP and tax-inclusive. VAT is never added on top: it is read out of
the gross price, for the "Includes £x VAT" lines. Rounding is half up, to the
penny, everywhere.
"""

from decimal import ROUND_HALF_UP, Decimal

PENNY = Decimal("0.01")
VAT_RATE = Decimal("0.20")
# v1 has one delivery option: free standard delivery, on every quote and order.
STANDARD_DELIVERY = Decimal("0.00")


def vat_included(gross: Decimal) -> Decimal:
    """The VAT inside a tax-inclusive amount: gross × 0.20 ÷ 1.20, i.e. gross ÷ 6.

    119.00 -> 19.83, 417.00 -> 69.50. Rounded half up to the penny.
    """
    return (gross * VAT_RATE / (1 + VAT_RATE)).quantize(PENNY, rounding=ROUND_HALF_UP)

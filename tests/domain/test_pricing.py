"""Tests for pricing.py: VAT is read out of tax-inclusive prices, never added on top."""

from decimal import Decimal

import pytest

from commercelab.domain import pricing


@pytest.mark.parametrize(
    ("gross", "vat"),
    [("119.00", "19.83"), ("268.00", "44.67"), ("417.00", "69.50"), ("0.05", "0.01"),
     ("0.00", "0.00")],
)
def test_vat_included_is_a_sixth_of_the_gross_rounded_half_up(gross, vat):
    assert pricing.vat_included(Decimal(gross)) == Decimal(vat)


def test_vat_included_is_always_to_the_penny():
    assert pricing.vat_included(Decimal("119.00")).as_tuple().exponent == -2


def test_rates_and_delivery():
    assert pricing.VAT_RATE == Decimal("0.20")
    assert pricing.STANDARD_DELIVERY == Decimal("0.00")

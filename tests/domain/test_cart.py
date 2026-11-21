"""Tests for domain/cart.py: the read-only cart quote."""

from decimal import Decimal

from commercelab.domain import cart, pricing
from tests.support.fakes import make_catalogue


def ids(conn):
    return make_catalogue(conn)["products"]


def test_quote_prices_lines_from_the_database(conn):
    p = ids(conn)
    result = cart.quote(conn, [(p["hero"], 2)])
    [line] = result["lines"]
    assert line["product"]["id"] == p["hero"]
    assert line["product"]["price"] == Decimal("119.00")
    assert line["requested"] == 2
    assert line["quantity"] == 2
    assert line["limited"] is False
    assert line["line_total"] == Decimal("238.00")
    assert "unit_cost" not in line["product"] and "available" not in line["product"]


def test_quote_totals_and_vat(conn):
    p = ids(conn)
    result = cart.quote(conn, [(p["hero"], 1), (p["low"], 2)])
    assert result["subtotal"] == Decimal("417.00")
    assert result["delivery"] == pricing.STANDARD_DELIVERY
    assert result["total"] == Decimal("417.00")
    assert result["vat_included"] == Decimal("69.50")


def test_quote_clamps_to_available(conn):
    p = ids(conn)
    [line] = cart.quote(conn, [(p["low"], 3)])["lines"]
    assert (line["requested"], line["quantity"], line["limited"]) == (3, 2, True)
    assert line["line_total"] == Decimal("298.00")


def test_quote_clamps_to_max_line_quantity(conn):
    p = ids(conn)
    [line] = cart.quote(conn, [(p["budget"], 500)])["lines"]
    assert line["quantity"] == cart.MAX_LINE_QUANTITY == 100
    assert line["limited"] is True
    assert line["line_total"] == Decimal("4500.00")


def test_sold_out_line_is_kept_at_zero(conn):
    p = ids(conn)
    result = cart.quote(conn, [(p["sold_out"], 1)])
    [line] = result["lines"]
    assert line["quantity"] == 0 and line["limited"] is True
    assert line["line_total"] == Decimal("0.00")
    assert result["total"] == Decimal("0.00")


def test_inactive_and_unknown_ids_are_removed(conn):
    p = ids(conn)
    result = cart.quote(conn, [(999_999, 1), (p["inactive"], 1), (p["hero"], 1), (999_998, 2)])
    assert result["removed"] == sorted([999_999, p["inactive"], 999_998])
    assert [line["product"]["id"] for line in result["lines"]] == [p["hero"]]


def test_empty_quote_is_all_zero(conn):
    result = cart.quote(conn, [])
    assert result["lines"] == [] and result["removed"] == []
    zero = Decimal("0.00")
    assert (result["subtotal"], result["delivery"], result["total"], result["vat_included"]) == (
        zero, zero, zero, zero,
    )


def test_quote_reserves_nothing(conn):
    p = ids(conn)
    before = conn.execute("SELECT count(*), coalesce(sum(reserved), 0) FROM inventory").fetchone()
    cart.quote(conn, [(p["hero"], 5), (p["low"], 2)])
    after = conn.execute("SELECT count(*), coalesce(sum(reserved), 0) FROM inventory").fetchone()
    assert before == after
    assert conn.execute("SELECT count(*) FROM reservations").fetchone()[0] == 0


def test_repeated_ids_merge_in_first_seen_order(conn):
    p = ids(conn)
    result = cart.quote(conn, [(p["low"], 1), (p["hero"], 1), (p["low"], 1)])
    assert [line["product"]["id"] for line in result["lines"]] == [p["low"], p["hero"]]
    assert result["lines"][0]["requested"] == 2
    assert result["lines"][0]["quantity"] == 2
    assert result["lines"][0]["limited"] is False

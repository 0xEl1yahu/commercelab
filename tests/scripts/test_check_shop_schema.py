from contextlib import nullcontext

import psycopg
import pytest


def test_complete_schema_with_empty_catalogue_passes(conn):
    from scripts.check_shop_schema import missing_relations

    assert conn.execute("SELECT count(*) FROM public.products").fetchone() == (0,)
    assert missing_relations(conn) == ()


def test_missing_schema_requests_restore(conn, monkeypatch, capsys):
    from scripts import check_shop_schema

    conn.execute("ALTER SCHEMA public RENAME TO misplaced")
    conn.execute("CREATE SCHEMA public")
    assert check_shop_schema.missing_relations(conn) == (
        "categories",
        "collection_products",
        "collections",
        "customers",
        "images",
        "inventory",
        "order_addresses",
        "order_items",
        "orders",
        "payments",
        "product_availability",
        "product_images",
        "products",
        "refunds",
        "reservations",
        "stock_movements",
    )

    monkeypatch.setattr(check_shop_schema, "connect", lambda: nullcontext(conn))
    with pytest.raises(SystemExit) as exit_info:
        check_shop_schema.main()

    assert exit_info.value.code == 1
    message = capsys.readouterr().err
    assert "restore" in message.lower()
    assert "product_availability" in message


def test_partial_schema_names_missing_relations(conn):
    from scripts.check_shop_schema import missing_relations

    conn.execute("CREATE SCHEMA misplaced")
    conn.execute("ALTER TABLE public.refunds SET SCHEMA misplaced")
    conn.execute("ALTER VIEW public.product_availability SET SCHEMA misplaced")
    conn.execute("CREATE TABLE public.product_availability (id integer)")
    conn.execute("SET LOCAL search_path TO misplaced, public")

    assert missing_relations(conn) == ("product_availability", "refunds")


def test_connection_failure_omits_credentials(monkeypatch, capsys):
    from scripts import check_shop_schema

    def fail_to_connect():
        raise psycopg.OperationalError("password=secret")

    monkeypatch.setattr(check_shop_schema, "connect", fail_to_connect)
    with pytest.raises(SystemExit) as exit_info:
        check_shop_schema.main()

    assert exit_info.value.code == 1
    message = capsys.readouterr().err
    assert "connect" in message.lower()
    assert "secret" not in message

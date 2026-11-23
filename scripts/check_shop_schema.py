"""Check that the restored public shop relations exist before starting the API."""

import sys

import psycopg

from commercelab.data.db import connect

TABLES = {
    "categories", "products", "images", "product_images", "collections",
    "collection_products", "customers", "orders", "order_items", "order_addresses",
    "inventory", "reservations", "stock_movements", "payments", "refunds",
}


def missing_relations(conn: psycopg.Connection) -> tuple[str, ...]:
    rows = conn.execute(
        """
        SELECT c.relname, c.relkind::text
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
        """
    )
    required = {(table, "r") for table in TABLES} | {("product_availability", "v")}
    return tuple(sorted(name for name, kind in required.difference(rows)))


def main() -> None:
    try:
        with connect() as conn:
            missing = missing_relations(conn)
    except psycopg.Error:
        print("Unable to connect to or inspect the shop database. Check database settings.", file=sys.stderr)
        raise SystemExit(1) from None
    if missing:
        print(
            f"Missing shop relations: {', '.join(missing)}. "
            "Restore the existing shop database using the README transfer procedure.",
            file=sys.stderr,
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()

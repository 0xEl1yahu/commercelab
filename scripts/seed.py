"""Deterministic demo data for CommerceLab.

Run from the repo root, after commercelab/data/db.sql has created the schema:

    uv run python -m scripts.seed            # seed 42
    uv run python -m scripts.seed --seed 7   # a different, equally reproducible dataset

Same seed -> identical rows: every random choice comes from one seeded RNG and
every timestamp is computed from fixed dates (never now()).

It wipes all tables first and refuses to run unless APP_ENV=demo.

What it simulates (Jan-Oct 2026):
  - a catalogue with a mid-year price rise on a few products, so old order
    items carry the old price (the "product repriced" invariant)
  - orders in every lifecycle state, each with reservations, payments and
    stock movements that are consistent with that state
  - occasional failed payment attempts before a success, a few 'unknown'
    payments on recent orders, and partial/full refunds on old orders
  - one limited product (catalogue_data.LIMITED_SKU) with exactly 2 in stock,
    for the design exercise

Product identity (sku, slug, name, brand, category) comes from
scripts/catalogue_data.py. Prices are placeholders until the seed content lands.
"""

import argparse
import hashlib
import json
import random
import sys
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from commercelab.config import settings
from commercelab.data import db
from scripts import catalogue_data
from scripts.catalogue_data import (
    DISCONTINUED_SKU,
    LIMITED_SKU,
    LOW_STOCK_SKUS,
    SOLD_OUT_SKU,
)

PENNY = Decimal("0.01")

CATALOGUE_DATE = datetime(2025, 12, 1, tzinfo=UTC)
OPENING_STOCK_DATE = datetime(2025, 12, 15, tzinfo=UTC)
START = datetime(2026, 1, 1, tzinfo=UTC)
REPRICE_DATE = datetime(2026, 7, 1, tzinfo=UTC)
END = datetime(2026, 10, 31, 23, 59, tzinfo=UTC)  # the simulated "now"

N_CUSTOMERS = 200
N_ORDERS = 1500
N_REPRICED = 5

# Placeholder price and cost for every product, until the seed content lands.
PLACEHOLDER_PRICE = "50.00"
PLACEHOLDER_COST = "20.00"
# Products whose stock or price a scenario depends on: never repriced.
SCENARIO_SKUS = {catalogue_data.SPOTLIGHT_SKU, LIMITED_SKU, *LOW_STOCK_SKUS, SOLD_OUT_SKU,
                 DISCONTINUED_SKU}


FIRST_NAMES = [
    "Ava", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hari", "Isla", "Jack",
    "Kira", "Leo", "Maya", "Noah", "Olivia", "Priya", "Quinn", "Ravi", "Sofia", "Tom",
]
LAST_NAMES = [
    "Adams", "Begum", "Clarke", "Davies", "Evans", "Fraser", "Green", "Hughes",
    "Iqbal", "Jones", "Khan", "Lewis", "Morgan", "Nash", "Owen", "Patel",
]


def money(value) -> Decimal:
    """Round to pence, half up: the single rounding rule for all seeded money."""
    return Decimal(value).quantize(PENNY, rounding=ROUND_HALF_UP)


# --- catalogue and customers -------------------------------------------------

def build_categories() -> list[dict]:
    return [
        {"slug": slug, "title": title, "description": description, "position": position}
        for position, (slug, title, description) in enumerate(catalogue_data.CATEGORIES, start=1)
    ]


def build_products(rng: random.Random) -> list[dict]:
    products = []
    for product_id, (sku, slug, name, brand, category) in enumerate(
        catalogue_data.PRODUCTS, start=1
    ):
        products.append({
            "id": product_id, "sku": sku, "slug": slug, "name": name, "brand": brand,
            "category": category, "price": money(PLACEHOLDER_PRICE),
            "unit_cost": money(PLACEHOLDER_COST),
            # Discontinued: deactivated, never deleted.
            "active": sku != DISCONTINUED_SKU,
            "created_at": END - timedelta(days=1) if sku == LIMITED_SKU else CATALOGUE_DATE,
            "price_before_reprice": None,
        })

    # A 10% price rise on a few products from REPRICE_DATE. products.price holds
    # the current price; earlier order items keep the old one.
    repriceable = [p for p in products if p["sku"] not in SCENARIO_SKUS]
    for product in rng.sample(repriceable, N_REPRICED):
        product["price_before_reprice"] = product["price"]
        product["price"] = money(product["price"] * Decimal("1.10"))
    return products


def price_at(product: dict, when: datetime) -> Decimal:
    if product["price_before_reprice"] is not None and when < REPRICE_DATE:
        return product["price_before_reprice"]
    return product["price"]


def build_customers(rng: random.Random) -> list[dict]:
    customers = []
    for customer_id in range(1, N_CUSTOMERS + 1):
        first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        customers.append({
            "id": customer_id,
            "name": f"{first} {last}",
            # The id suffix keeps emails unique even when names repeat.
            "email": f"{first}.{last}{customer_id}@example.com".lower(),
            "created_at": START - timedelta(days=rng.randint(1, 200)),
        })
    return customers


# --- order simulation ----------------------------------------------------------

def pick_status(rng: random.Random, placed_at: datetime) -> str:
    age = END - placed_at
    if rng.random() < 0.07:
        return "cancelled"
    if age < timedelta(days=2):
        return rng.choice(["pending", "paid"])
    if age < timedelta(days=10):
        return "paid"
    return "fulfilled"


def request_hash(customer_id: int, items: list[dict]) -> str:
    body = {"customer_id": customer_id,
            "items": sorted([i["product_id"], i["quantity"]] for i in items)}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def simulate(rng: random.Random, products: list[dict], customers: list[dict]) -> dict:
    on_hand = {p["id"]: 0 for p in products}
    reserved = {p["id"]: 0 for p in products}
    data = {k: [] for k in
            ("orders", "order_items", "reservations", "stock_movements", "payments", "refunds")}

    def move(product_id, delta, reason, at, order_id=None):
        on_hand[product_id] += delta
        data["stock_movements"].append({
            "product_id": product_id, "quantity_delta": delta, "reason": reason,
            "order_id": order_id, "created_at": at,
        })

    def add_payment(order_id, amount, status, at):
        payment_id = len(data["payments"]) + 1
        data["payments"].append({
            "id": payment_id, "order_id": order_id, "amount": amount, "status": status,
            "provider_reference": None if status == "pending" else f"sim_{payment_id:06d}",
            "created_at": at, "updated_at": at + timedelta(seconds=rng.randint(1, 30)),
        })
        return payment_id

    for product in products:
        if product["sku"] == LIMITED_SKU:
            move(product["id"], 2, "restock", product["created_at"])
        else:
            move(product["id"], rng.randint(40, 120), "restock", OPENING_STOCK_DATE)

    # The limited keyboard and the discontinued product are never ordered.
    sellable = [p for p in products if p["active"] and p["sku"] != LIMITED_SKU]
    span = int((END - START).total_seconds())
    placed_times = sorted(START + timedelta(seconds=rng.randint(0, span)) for _ in range(N_ORDERS))

    for order_id, placed_at in enumerate(placed_times, start=1):
        customer = rng.choice(customers)
        n_lines = rng.choices([1, 2, 3, 4], weights=[50, 30, 15, 5])[0]
        items = [{
            "order_id": order_id, "product_id": p["id"],
            "quantity": rng.choices([1, 2, 3], weights=[70, 22, 8])[0],
            "unit_price": price_at(p, placed_at), "unit_cost": p["unit_cost"],
            "product_name": p["name"], "sku": p["sku"],
        } for p in rng.sample(sellable, n_lines)]
        total = money(sum(i["quantity"] * i["unit_price"] for i in items))
        status = pick_status(rng, placed_at)

        data["orders"].append({
            "id": order_id, "customer_id": customer["id"], "status": status, "total": total,
            "idempotency_key": f"seed-{order_id:06d}",
            "request_hash": request_hash(customer["id"], items),
            "public_token": f"{rng.getrandbits(128):032x}", "created_at": placed_at,
        })
        data["order_items"].extend(items)

        # Every checkout reserves stock; restock first if it would run short.
        reservation_status = {"pending": "active", "cancelled": "released"}.get(status, "committed")
        for item in items:
            pid, qty = item["product_id"], item["quantity"]
            if on_hand[pid] - reserved[pid] < qty:
                move(pid, rng.randint(50, 150), "restock", placed_at - timedelta(hours=1))
            data["reservations"].append({
                "order_id": order_id, "product_id": pid, "quantity": qty,
                "status": reservation_status, "expires_at": None, "created_at": placed_at,
            })
            if status == "pending":
                reserved[pid] += qty

        paid_at = placed_at + timedelta(minutes=rng.randint(1, 5))
        if status == "pending":
            add_payment(order_id, total, rng.choice(["pending", "unknown"]), paid_at)
        elif status == "cancelled":
            add_payment(order_id, total, "failed", paid_at)
        else:
            if rng.random() < 0.05:  # a declined first attempt, then a successful retry
                add_payment(order_id, total, "failed", paid_at)
                paid_at += timedelta(minutes=rng.randint(1, 10))
            payment_id = add_payment(order_id, total, "succeeded", paid_at)
            for item in items:
                move(item["product_id"], -item["quantity"], "sale", paid_at, order_id)

            refund_at = paid_at + timedelta(days=rng.randint(3, 20))
            if status == "fulfilled" and refund_at < END and rng.random() < 0.04:
                if len(items) > 1 and rng.random() < 0.5:   # refund one line
                    amount = money(items[0]["quantity"] * items[0]["unit_price"])
                    reason = "item returned"
                elif rng.random() < 0.5:                     # full refund
                    amount, reason = total, "order returned"
                else:                                        # goodwill partial refund
                    amount = money(total * Decimal(rng.choice([10, 20, 25])) / 100)
                    reason = "goodwill"
                data["refunds"].append({
                    "payment_id": payment_id, "amount": amount, "status": "succeeded",
                    "reason": reason, "created_at": refund_at,
                })

    data["inventory"] = [{
        "product_id": pid, "on_hand": on_hand[pid], "reserved": reserved[pid], "updated_at": END,
    } for pid in on_hand]
    return data


# --- writing ------------------------------------------------------------------

# Every table, children before their parents.
ALL_TABLES = ("refunds, payments, stock_movements, reservations, inventory, "
              "order_addresses, order_items, orders, customers, "
              "collection_products, collections, product_images, images, products, categories")

COLUMNS = {
    "categories": ["slug", "title", "description", "position"],
    "products": ["sku", "slug", "name", "brand", "category", "price", "unit_cost", "active",
                 "created_at"],
    "images": ["sha256", "content_type", "data", "source_url", "licence", "credit"],
    "product_images": ["product_id", "position", "image_sha256", "alt"],
    "collections": ["slug", "title", "description", "position"],
    "collection_products": ["collection_id", "product_id", "position"],
    "customers": ["name", "email", "created_at"],
    "orders": ["customer_id", "status", "total", "idempotency_key", "request_hash",
               "public_token", "created_at"],
    "order_items": ["order_id", "product_id", "quantity", "unit_price", "unit_cost",
                    "product_name", "sku"],
    "order_addresses": ["order_id", "name", "phone", "company", "vat_number", "line1", "line2",
                        "city", "postcode", "country"],
    "inventory": ["product_id", "on_hand", "reserved", "updated_at"],
    "reservations": ["order_id", "product_id", "quantity", "status", "expires_at", "created_at"],
    "stock_movements": ["product_id", "quantity_delta", "reason", "order_id", "created_at"],
    "payments": ["order_id", "amount", "status", "provider_reference", "created_at", "updated_at"],
    "refunds": ["payment_id", "amount", "status", "reason", "created_at"],
}

# Parent tables: other rows reference their ids, so each insert is checked
# against the id the simulation assumed.
TABLES_WITH_PLANNED_IDS = {"products", "customers", "orders", "payments"}


def insert_rows(cur: psycopg.Cursor, table: str, rows: list[dict]) -> None:
    columns = COLUMNS[table]
    # Table and column names come from the constants above, never from input.
    sql = (f"INSERT INTO {table} ({', '.join(columns)}) "
           f"VALUES ({', '.join(['%s'] * len(columns))})")
    params = [[row[c] for c in columns] for row in rows]
    if table in TABLES_WITH_PLANNED_IDS:
        # returning=True sends every row in one batch and keeps each RETURNING result.
        # Each inserted row produces its own result set; walk them with nextset().
        cur.executemany(sql + " RETURNING id", params, returning=True)
        assigned = []
        while True:
            assigned.append(cur.fetchone()[0])
            if not cur.nextset():
                break
        planned = [row["id"] for row in rows]
        if assigned != planned:
            raise RuntimeError(f"{table}: database assigned ids that differ from the plan")
    else:
        cur.executemany(sql, params)


def write(conn: psycopg.Connection, products, customers, data) -> None:
    with conn.cursor() as cur:
        # RESTART IDENTITY makes the ids start at 1 again, matching the plan.
        cur.execute(f"TRUNCATE {ALL_TABLES} RESTART IDENTITY")
        insert_rows(cur, "categories", data["categories"])
        insert_rows(cur, "products", products)
        insert_rows(cur, "customers", customers)
        for table in ("orders", "order_items", "inventory", "reservations",
                      "stock_movements", "payments", "refunds"):
            insert_rows(cur, table, data[table])


def generate(seed: int) -> tuple[list[dict], list[dict], dict]:
    """Build the whole dataset in memory. Pure: touches no database."""
    rng = random.Random(seed)
    products = build_products(rng)
    customers = build_customers(rng)
    data = simulate(rng, products, customers)
    data["categories"] = build_categories()
    return products, customers, data


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Load deterministic demo data.")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)

    if settings.app_env != "demo":
        sys.exit(f"Refusing to seed: APP_ENV is {settings.app_env!r}, not 'demo'.")

    products, customers, data = generate(args.seed)

    # One transaction: commits on success, rolls back everything on any error,
    # so the database is never left half-seeded.
    with db.connect() as conn, conn.transaction():
        write(conn, products, customers, data)

    counts = {"products": len(products), "customers": len(customers),
              **{t: len(data[t]) for t in COLUMNS if t in data}}
    print(f"Seeded (seed={args.seed}): " + ", ".join(f"{n} {t}" for t, n in counts.items()))


if __name__ == "__main__":
    main()

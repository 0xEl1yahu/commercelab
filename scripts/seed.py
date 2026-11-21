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
  - one limited keyboard with exactly 2 in stock, for the design exercise
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

PENNY = Decimal("0.01")

CATALOGUE_DATE = datetime(2025, 12, 1, tzinfo=UTC)
OPENING_STOCK_DATE = datetime(2025, 12, 15, tzinfo=UTC)
START = datetime(2026, 1, 1, tzinfo=UTC)
REPRICE_DATE = datetime(2026, 7, 1, tzinfo=UTC)
END = datetime(2026, 10, 31, 23, 59, tzinfo=UTC)  # the simulated "now"

N_CUSTOMERS = 200
N_ORDERS = 1500
N_REPRICED = 5
LIMITED_SKU = "KB-LTD-01"

# sku, name, category, price, unit_cost
CATALOGUE = [
    ("KB-TKL-01", "Tenkeyless Mechanical Keyboard", "keyboards", "89.00", "41.00"),
    ("KB-FULL-01", "Full-size Mechanical Keyboard", "keyboards", "109.00", "52.00"),
    ("KB-65-01", "65% Wireless Keyboard", "keyboards", "129.00", "63.00"),
    ("KB-LOW-01", "Low-profile Keyboard", "keyboards", "69.00", "30.00"),
    ("MS-ERG-01", "Ergonomic Vertical Mouse", "mice", "49.00", "19.50"),
    ("MS-GAM-01", "Lightweight Gaming Mouse", "mice", "59.00", "24.00"),
    ("MS-TRV-01", "Travel Mouse", "mice", "25.00", "9.00"),
    ("MN-27Q-01", "27in QHD Monitor", "monitors", "279.00", "182.00"),
    ("MN-32K-01", "32in 4K Monitor", "monitors", "449.00", "301.00"),
    ("MN-24F-01", "24in FHD Monitor", "monitors", "139.00", "88.00"),
    ("MN-ARM-01", "Single Monitor Arm", "monitors", "45.00", "17.00"),
    ("AU-HP-01", "Closed-back Headphones", "audio", "99.00", "44.00"),
    ("AU-EB-01", "Wireless Earbuds", "audio", "79.00", "33.00"),
    ("AU-MIC-01", "USB Condenser Microphone", "audio", "65.00", "27.00"),
    ("AU-SPK-01", "Desktop Speakers", "audio", "119.00", "58.00"),
    ("CB-USBC-01", "USB-C Cable 2m", "cables", "12.00", "2.40"),
    ("CB-HDMI-01", "HDMI 2.1 Cable 2m", "cables", "15.00", "3.10"),
    ("CB-DOCK-01", "USB-C Docking Station", "cables", "149.00", "78.00"),
    ("CB-HUB-01", "7-port USB Hub", "cables", "35.00", "13.00"),
    ("DK-MAT-01", "Large Desk Mat", "desk", "29.00", "8.50"),
    ("DK-LAMP-01", "LED Desk Lamp", "desk", "55.00", "21.00"),
    ("DK-STD-01", "Laptop Stand", "desk", "39.00", "14.00"),
    ("DK-RST-01", "Wrist Rest", "desk", "19.00", "5.20"),
    ("DK-CAM-01", "1080p Webcam", "desk", "69.00", "29.00"),
]

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

def build_products(rng: random.Random) -> list[dict]:
    products = []
    for product_id, (sku, name, category, price, cost) in enumerate(CATALOGUE, start=1):
        products.append({
            "id": product_id, "sku": sku, "name": name, "category": category,
            "price": money(price), "unit_cost": money(cost), "active": True,
            "created_at": CATALOGUE_DATE, "price_before_reprice": None,
        })

    # A 10% price rise on a few products from REPRICE_DATE. products.price holds
    # the current price; earlier order items keep the old one.
    for product in rng.sample(products, N_REPRICED):
        product["price_before_reprice"] = product["price"]
        product["price"] = money(product["price"] * Decimal("1.10"))

    # One discontinued product: still referenced by old orders, so never deleted.
    rng.choice(products)["active"] = False

    products.append({
        "id": len(products) + 1, "sku": LIMITED_SKU, "name": "Limited Edition Keyboard",
        "category": "keyboards", "price": money("199.00"), "unit_cost": money("95.00"),
        "active": True, "created_at": END - timedelta(days=1), "price_before_reprice": None,
    })
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
        } for p in rng.sample(sellable, n_lines)]
        total = money(sum(i["quantity"] * i["unit_price"] for i in items))
        status = pick_status(rng, placed_at)

        data["orders"].append({
            "id": order_id, "customer_id": customer["id"], "status": status, "total": total,
            "idempotency_key": f"seed-{order_id:06d}",
            "request_hash": request_hash(customer["id"], items), "created_at": placed_at,
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

ALL_TABLES = ("refunds, payments, stock_movements, reservations, inventory, "
              "order_items, orders, customers, products")

COLUMNS = {
    "products": ["sku", "name", "category", "price", "unit_cost", "active", "created_at"],
    "customers": ["name", "email", "created_at"],
    "orders": ["customer_id", "status", "total", "idempotency_key", "request_hash", "created_at"],
    "order_items": ["order_id", "product_id", "quantity", "unit_price", "unit_cost"],
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
    return products, customers, simulate(rng, products, customers)


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

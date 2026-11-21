"""Test doubles and small data builders shared across test modules."""

import hashlib
import json
import threading
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from commercelab.domain import inventory
from commercelab.domain.customers import DeliveryAddress
from commercelab.domain.payments import Charge
from scripts.catalogue_data import CATEGORIES

# A valid UK delivery address for checkouts in tests.
DELIVERY = DeliveryAddress(
    name="Ann Lee", phone="07700 900000", line1="1 Test Street", city="Leeds", postcode="LS1 1AA"
)


class ScriptedProvider:
    """A payment provider whose behaviour each test chooses.

    Like a real provider, it decides each key's outcome once and repeats it on
    every retry. Two ways to fail, matching the two kinds of "unknown":
      down           raises before charging: the customer was NOT charged
      lose_response  charges, then raises: the customer WAS charged, but we
                     never heard (the dangerous case for reconciliation)
    """

    def __init__(self, outcome: str = "succeeded"):
        self.outcome = outcome
        self.down = False
        self.lose_response = False
        self.charged: dict[str, Charge] = {}  # key -> outcome, i.e. real charges
        self.calls = 0
        self.lookups = 0
        self.lock = threading.Lock()
        self.on_charge = None  # optional hook, called with the key

    def charge(self, *, idempotency_key: str, amount: Decimal) -> Charge:
        with self.lock:
            self.calls += 1
            if self.down:
                raise TimeoutError("provider did not respond")
            if self.on_charge:
                self.on_charge(idempotency_key)
            if idempotency_key not in self.charged:
                self.charged[idempotency_key] = Charge(self.outcome, f"ref-{idempotency_key}")
            if self.lose_response:
                raise TimeoutError("charged, but the response was lost")
            return self.charged[idempotency_key]

    def lookup(self, *, idempotency_key: str) -> Charge | None:
        with self.lock:
            self.lookups += 1
            if self.down:
                raise TimeoutError("provider did not respond")
            return self.charged.get(idempotency_key)


def insert_product(
    conn,
    sku: str,
    name: str,
    price,
    cost,
    *,
    category: str = "test",
    brand: str = "Testco",
    slug: str | None = None,
    active: bool = True,
) -> int:
    """Insert one product (and its category, if new). Returns the id. No stock.

    The slug defaults to the sku lowercased, so skus like "KB" or "MUG-2" work.
    """
    conn.execute(
        "INSERT INTO categories (slug, title) VALUES (%s, %s) ON CONFLICT (slug) DO NOTHING",
        [category, category.replace("-", " ").title()],
    )
    return conn.execute(
        "INSERT INTO products (sku, slug, name, brand, category, price, unit_cost, active) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        [sku, slug or sku.lower(), name, brand, category, price, cost, active],
    ).fetchone()[0]


def insert_image(conn, payload: bytes = b"img", content_type: str = "image/jpeg") -> str:
    """Store image bytes. Returns the key (their sha256), as the schema requires."""
    key = hashlib.sha256(payload).hexdigest()
    conn.execute(
        "INSERT INTO images (sha256, content_type, data) VALUES (%s, %s, %s) "
        "ON CONFLICT (sha256) DO NOTHING",
        [key, content_type, payload],
    )
    return key


def make_shop(conn) -> dict:
    """A customer, a keyboard with 2 in stock and a mouse with 10."""

    def product(sku, name, price, cost, on_hand):
        product_id = insert_product(conn, sku, name, price, cost)
        inventory.restock(conn, product_id, on_hand)
        return product_id

    return {
        "customer": conn.execute(
            "INSERT INTO customers (name, email) VALUES ('Ann', 'ann@example.com') RETURNING id"
        ).fetchone()[0],
        "keyboard": product("KB", "Keyboard", "199.00", "95.00", 2),
        "mouse": product("MS", "Mouse", "25.00", "9.00", 10),
    }


# name: (category, brand, price, unit_cost, stock, active)
CATALOGUE = {
    "hero": ("keyboards", "Halden", "119.00", "52.00", 20, True),
    "low": ("mice", "Kestrel", "149.00", "66.00", 2, True),
    "sold_out": ("keyboards", "Marlow", "64.00", "27.00", 0, True),
    "inactive": ("keyboards", "Testco", "99.00", "40.00", 10, False),
    "budget": ("keyboards", "Marlow", "45.00", "18.00", 150, True),
    "mid": ("mice", "Kestrel", "59.00", "24.00", 30, True),
    "premium": ("keyboards", "Halden", "180.00", "81.00", 30, True),
}
CATALOGUE_START = datetime(2026, 1, 1, tzinfo=UTC)
HERO_TAGLINE = "Quiet keys. Three devices. One cable."
HERO_SPECS = [
    {"label": "Layout", "value": "UK ISO, 75%"},
    {"label": "Connection", "value": "Bluetooth 5.3, USB-C"},
    {"label": "Battery", "value": "Up to 3 months"},
    {"label": "Weight", "value": "610 g"},
]


def make_catalogue(conn) -> dict:
    """A small storefront catalogue: two categories, three brands, seven products.

    Returns {"products": {name: id}, "collections": {"featured": id}}.

      name      category   brand    price   stock  notes
      hero      keyboards  Halden   119.00  20     tagline, 3 images, 4 specs
      low       mice       Kestrel  149.00  2      "Only 2 left"
      sold_out  keyboards  Marlow   64.00   0
      inactive  keyboards  Testco   99.00   10     active = false
      budget    keyboards  Marlow   45.00   150
      mid       mice       Kestrel  59.00   30
      premium   keyboards  Halden   180.00  30

    Each product's created_at is one day after the previous one's, in that
    order (hero oldest, premium newest), so "featured" sorting is deterministic.
    The product's name is its key, its sku the key upper-cased ("SOLD-OUT").
    The `featured` collection holds hero, low and mid, in that order.
    """
    titles = {slug: (title, description) for slug, title, description in CATEGORIES}
    for position, slug in enumerate(("keyboards", "mice"), start=1):
        conn.execute(
            "INSERT INTO categories (slug, title, description, position) VALUES (%s, %s, %s, %s)",
            [slug, *titles[slug], position],
        )

    products = {}
    for day, (name, (category, brand, price, cost, stock, active)) in enumerate(CATALOGUE.items()):
        product_id = insert_product(
            conn, name.upper().replace("_", "-"), name, price, cost,
            category=category, brand=brand, active=active,
        )
        conn.execute(
            "UPDATE products SET created_at = %s WHERE id = %s",
            [CATALOGUE_START + timedelta(days=day), product_id],
        )
        if stock:
            inventory.restock(conn, product_id, stock)
        else:
            conn.execute("INSERT INTO inventory (product_id) VALUES (%s)", [product_id])
        products[name] = product_id

    conn.execute(
        "UPDATE products SET tagline = %s, description = %s, specs = %s WHERE id = %s",
        [HERO_TAGLINE, "A low-profile wireless keyboard for long working days.",
         json.dumps(HERO_SPECS), products["hero"]],
    )
    for position, suffix in enumerate(("", ", side view", ", in use"), start=1):
        key = insert_image(conn, f"hero-image-{position}".encode())
        conn.execute(
            "INSERT INTO product_images (product_id, position, image_sha256, alt) "
            "VALUES (%s, %s, %s, %s)",
            [products["hero"], position, key, f"Halden hero{suffix}"],
        )

    featured = conn.execute(
        "INSERT INTO collections (slug, title, description, position) "
        "VALUES ('featured', 'Featured', 'Our pick of the range.', 1) RETURNING id"
    ).fetchone()[0]
    for position, name in enumerate(("hero", "low", "mid"), start=1):
        conn.execute(
            "INSERT INTO collection_products (collection_id, product_id, position) "
            "VALUES (%s, %s, %s)",
            [featured, products[name], position],
        )
    return {"products": products, "collections": {"featured": featured}}

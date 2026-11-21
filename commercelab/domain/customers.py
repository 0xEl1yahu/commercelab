"""Customers: who is checking out, and where the order goes.

There are no accounts. A guest checkout names a customer by email, and the
same email (in any letter case) is always the same customer; the schema's
unique index on lower(email) enforces it.

The delivery address is not stored on the customer: it is copied onto each
order (order_addresses), so an order keeps the address it was placed with.
"""

from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class Contact:
    """The shopper's contact details, as typed at checkout."""

    email: str
    name: str
    phone: str


@dataclass(frozen=True)
class DeliveryAddress:
    """One order's delivery address. UK only in v1.

    name and phone are the recipient's: the checkout form takes them from the
    contact details.
    """

    name: str
    phone: str
    line1: str
    city: str
    postcode: str
    line2: str | None = None
    company: str | None = None
    vat_number: str | None = None
    country: str = "GB"


def find_or_create(conn: psycopg.Connection, contact: Contact) -> int:
    """The id of the customer with this email (case-insensitively), creating them if new.

    The email is expected already stripped of whitespace (ContactIn does it).

    Safe under concurrency: two first-time checkouts with one new email get
    the same id and one row. Never overwrites an existing customer's name or
    phone.

    The INSERT decides it, against the unique index on lower(email): if another
    transaction has inserted the same email and not yet committed, the INSERT
    waits for it. If that one commits, ON CONFLICT DO NOTHING returns no row and
    the SELECT (a new statement, so a fresh snapshot) finds the committed
    customer; if it rolls back, the INSERT goes ahead. A read-then-insert would
    let both checkouts see no customer, and the second would fail on the index.
    """
    with conn.transaction():
        created = conn.execute(
            "INSERT INTO customers (name, email, phone) VALUES (%s, %s, %s) "
            "ON CONFLICT ((lower(email))) DO NOTHING RETURNING id",
            [contact.name, contact.email, contact.phone],
        ).fetchone()
        if created is not None:
            return created[0]
        return conn.execute(
            "SELECT id FROM customers WHERE lower(email) = lower(%s)", [contact.email]
        ).fetchone()[0]

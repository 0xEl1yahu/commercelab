"""Resolve orders left pending: unknown payments and expired stock holds.

Run from the repo root:

    uv run python -m scripts.reconcile --dry-run   # list what it would look at
    uv run python -m scripts.reconcile             # settle them

Safe to run as often as you like (by hand, or from cron every few minutes):
each order is settled at most once, and an order the provider can't answer
for is left alone until the next run. See orders.reconcile for the rules.

Demo only for now: there is no live payment provider to ask. The simulated
provider in this process has never charged anything, so here it can only
answer "never charged": unknown payments stay pending and expired holds are
released. A real provider would also report charges made by the API process.
"""

import argparse
import sys
from collections import Counter

from commercelab.config import settings
from commercelab.data import db
from commercelab.domain import orders, payments


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="list candidates, change nothing")
    args = parser.parse_args(argv)

    if settings.app_env != "demo":
        sys.exit("Refusing to reconcile: no live payment provider is configured.")

    with db.connect() as conn:
        if args.dry_run:
            candidates = orders.reconcile_candidates(conn)
            for c in candidates:
                reason = "hold expired" if c.hold_expired else "payment unknown"
                print(f"order {c.order_id}: payment {c.payment_id} {c.payment_status}, {reason}")
            print(f"{len(candidates)} order(s) would be checked")
            return

        results = orders.reconcile(conn, payments.SimulatedProvider())

    summary = Counter(results.values())
    print(
        f"Checked {len(results)} order(s): {summary['paid']} paid, "
        f"{summary['cancelled']} cancelled, {summary['unchanged']} unchanged"
    )


if __name__ == "__main__":
    main()

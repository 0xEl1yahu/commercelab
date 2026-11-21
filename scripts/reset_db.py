"""Reset a dev or end-to-end database to the seed-42 demo data.

    uv run python -m scripts.reset_db

Creates the database if it is missing, applies commercelab/data/db.sql (which
drops and recreates every table), then loads seed 42 with the cached stock-photo
bytes, in one transaction. Run scripts.fetch_images first so the bytes are cached.

It refuses unless APP_ENV=demo and the database is named `commercelab` or ends in
`_e2e`. It never touches a shop's real database, nor the `_test` database that the
test suite rebuilds itself.

Paths are relative to the repo root: run it from there.
"""

import argparse
import sys
from pathlib import Path

from psycopg import conninfo

from commercelab.config import settings
from commercelab.data import db
from scripts import image_manifest, seed

SCHEMA_FILE = Path("commercelab/data/db.sql")
SEED = 42


def allowed(dbname: str) -> bool:
    return dbname == "commercelab" or dbname.endswith("_e2e")


def main(argv: list[str] | None = None) -> None:
    argparse.ArgumentParser(description="Reset a dev or e2e database to the demo data.").parse_args(argv)

    dbname = conninfo.conninfo_to_dict(settings.database_url).get("dbname") or ""
    if settings.app_env != "demo" or not allowed(dbname):
        sys.exit(
            f"Refusing to reset {dbname!r}: APP_ENV must be 'demo' (it is {settings.app_env!r}) "
            "and the database must be named 'commercelab' or end in '_e2e'."
        )

    db.create_database_if_missing(settings.database_url)
    # db.sql has its own BEGIN/COMMIT, so it runs on an autocommit connection, not inside a transaction.
    with db.connect() as conn:
        conn.execute(SCHEMA_FILE.read_text())

    products, customers, data = seed.generate(SEED)
    try:
        with db.connect() as conn, conn.transaction():
            seed.write(conn, products, customers, data,
                       image_bytes=image_manifest.cached_bytes)
    except FileNotFoundError as exc:  # a missing cached image: say what to run
        sys.exit(str(exc))

    print(f"Reset {dbname}: schema applied, seeded (seed={SEED})")


if __name__ == "__main__":
    main()

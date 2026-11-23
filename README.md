### PROJECT SUMMARY 

**CommerceLab**, an all-in-one e-commerce system with a seeded, functioning storefront that can evolve towards a real business without rewriting the core domain logic. The goal is not to collect frameworks: it is to demonstrate design decisions, controlled experiments, invariants, failure handling and tests.

The application should support:

- Product catalogue and storefront, carts and checkout
- Orders, inventory, simulated payments, refunds and stock movements
- An operational **PostgreSQL** database as the sole source of truth
- A **DuckDB** analytical component for read-only consumption of operational data and heavier analytics
- **pandas** for analysis, **NumPy** for simulation/forecasting, **Matplotlib** for visualisation
- A Next.js/React frontend talking to a Python/FastAPI backend
- Deterministic seeded data and tests that prove correctness
- A possible future AI assistant using function/tool calling (provider/framework not yet selected)

**Learning objective:** build the system largely in Python to practise functions, loops, conditionals, modules, exceptions, SQL, pandas, NumPy, Matplotlib, tests and system design — and be able to explain why every significant component exists.

## Status

The backend and the Next.js storefront are built: catalogue,
bag, one-page guest checkout with retry-safe payment, order page. Analytics
(DuckDB, pandas) comes later. How it works: [`docs/architecture.md`](docs/architecture.md).

## Running it natively on a Mac

**You need:** PostgreSQL 17 running locally, [uv](https://docs.astral.sh/uv/), and Node (with npm).

```bash
# 1. Backend setup (repo root)
uv sync
cp .env.example .env                       # optional: the defaults work with a local `commercelab` database
uv run python -m scripts.fetch_images      # downloads the stock photos into .cache/images (git-ignored)
uv run python -m scripts.reset_db          # creates the database, applies the schema, seeds the demo data

# 2. Run the API (http://127.0.0.1:8000, docs at /docs)
uv run uvicorn commercelab.main:app --reload

# 3. Run the storefront (second terminal, http://localhost:3000)
cd frontend
npm ci                                     # if the default npm cache misbehaves: npm ci --cache /tmp/npm-cache
API_URL=http://127.0.0.1:8000 npm run dev  # API_URL is the default; it is read on the server only
```

`reset_db` drops and recreates every table. It **refuses** to run unless
`APP_ENV=demo` and the database is named `commercelab` or ends in `_e2e`, so it
can't touch a real database or the `_test` one. Image bytes are stored in PostgreSQL,
so run `fetch_images` first: a missing photo stops `reset_db` before it changes anything.

Settings come from the environment or `.env` (see `.env.example`). One is worth
knowing: `SIMULATED_DECLINE_PERCENT` (default 5) is the share of payments the
demo payment provider declines, so you can see the declined-card flow. Set it to
`0` for a run with no surprises (the e2e tests do).

## Running the existing shop in Docker

After the one-time transfer below, run `docker compose up` from the repo root.
Open http://localhost:3000 for the shop or http://localhost:8000/docs for the API.
Use Ctrl-C or `docker compose down` to stop. Keep using the same Compose project
name so it reattaches the same database volume. **`docker compose down -v` deletes this copy of the shop.** If a host port is occupied, stop the native
server or set `WEB_HOST_PORT` and `API_HOST_PORT` in your local environment.

### First transfer from native PostgreSQL 17

Start Docker Desktop. Press Ctrl-C in the terminals running the native
storefront and API. Stop other shop writers, including reconciliation. Keep native PostgreSQL running until verification is
complete. Use PostgreSQL 17 client tools on the Mac. These commands assume the
native database is `postgresql://localhost/commercelab`; set `SHOP_SOURCE_DSN`
if yours differs.

Set `COMMERCE_DB_PASSWORD` once in your gitignored root `.env`. To add a random
value without displaying it, run this from the repository root.

```bash
(umask 077
 if ! grep -qs '^COMMERCE_DB_PASSWORD=.' .env; then
   printf '\nCOMMERCE_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env
 fi)
```

Keep this value with the volume. PostgreSQL uses it to create the account on
first initialisation. The transfer below creates a private backup directory
under your home directory. It aborts on an occupied target or a verification
difference. Leave the native writers stopped until the comparison succeeds.

```bash
(
  set -eu
  umask 077
  source_dsn=${SHOP_SOURCE_DSN:-postgresql://localhost/commercelab}
  backup_dir=$(mktemp -d "$HOME/commercelab-transfer.XXXXXXXX")
  echo "Local backup directory: $backup_dir"
  pg_dump --format=custom --file="$backup_dir/shop.dump" --dbname="$source_dsn"
  docker compose up -d --wait db
  db_exec() { docker compose exec -T db "$@"; }
  target_sql() { db_exec psql -X -v ON_ERROR_STOP=1 -U commercelab -d commercelab "$@"; }
  objects=$(target_sql -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n
    ON n.oid=c.relnamespace WHERE n.nspname='public'")
  if [ "$objects" != 0 ]; then
    echo "Restore stopped: the target already contains relations." >&2
    exit 1
  fi
  db_exec pg_restore -U commercelab -d commercelab --single-transaction \
    --exit-on-error --no-owner --no-acl < "$backup_dir/shop.dump"

  cat > "$backup_dir/verify.sql" <<'SQL'
SELECT (SELECT count(*) FROM products), (SELECT count(*) FROM orders),
       (SELECT count(*) FROM images);
SELECT status, count(*), sum(total) FROM orders GROUP BY status ORDER BY status COLLATE "C";
SELECT product_id, on_hand, reserved, available FROM product_availability ORDER BY product_id;
SELECT sha256, encode(sha256(data), 'hex') FROM images ORDER BY sha256 COLLATE "C";
SQL
  psql -X -v ON_ERROR_STOP=1 -At -d "$source_dsn" < "$backup_dir/verify.sql" > "$backup_dir/native"
  target_sql -At < "$backup_dir/verify.sql" > "$backup_dir/docker"
  cmp "$backup_dir/native" "$backup_dir/docker"
  echo "Verified the transfer. Start the shop with docker compose up."
)
```

After cutover, new orders and stock changes go to Docker. Retain the original
database and dump. If startup reports missing relations, check the selected
project and volume, then inspect the transfer result. A complete schema with
zero products starts normally.

Run `scripts/compose_smoke.sh` to rehearse a transfer, place an order and test
restart persistence on a disposable project using synthetic data and separate
ports. Docker disk I/O errors on the external drive require stopping the run
and checking the drive before retrying.

## Tests and checks

```bash
# Backend (repo root). Needs local PostgreSQL; the commercelab_test database is created and rebuilt automatically.
uv run pytest -q
uv run ruff check .

# Frontend (from frontend/)
npm test                  # unit tests (vitest)
npm run typecheck         # regenerates lib/api-types.ts, fails if it changed, then tsc
npm run lint
npm run e2e               # Playwright against the real backend; builds the app first (slow)
```

`npm run e2e` starts its own backend on its own database, so it never touches
your dev data. To run two copies at once, give each its own database and ports:

```bash
E2E_DATABASE_URL=postgresql://localhost/commercelab_mine_e2e E2E_API_PORT=8140 E2E_WEB_PORT=3140 npm run e2e
```

(`E2E_API_PORT` defaults to 8100 and `E2E_WEB_PORT` to 3100; the backend-down
check uses the web port plus one. The database name must end in `_e2e`.)

**After any change to `commercelab/api/models.py` or a route,** regenerate the
contract, then the frontend types. A test fails until you do:

```bash
uv run python -m scripts.export_openapi   # rewrites openapi.json
cd frontend && npm run gen:api            # rewrites lib/api-types.ts
```

Other scripts: `uv run python -m scripts.seed` (demo data only, seed 42) and
`uv run python -m scripts.reconcile --dry-run` (lists orders whose payment is
unconfirmed; without `--dry-run` it resolves them).

## Architectural principles

1. **Modular monolith:** one Python backend with logical modules, not microservices by default.
2. **Thin `main.py`:** initialise/register the API; no business logic or ad hoc SQL inside it.
3. **Clear ownership:** order rules in `orders.py`, stock rules in `inventory.py`, connections/transactions in `db.py`, analytics in `analytics/`.
4. **One operational source of truth:** PostgreSQL owns customers, products, orders, payments, stock and refunds. DuckDB never writes operational records back into PostgreSQL.
5. **Analytical freshness is explicit:** live Postgres queries and cached DuckDB reports must not be confused. A read-only DuckDB-to-Postgres connection does *not* guarantee a persisted DuckDB copy is current.
6. **Incremental work where justified:** update only affected analytical records/partitions, with durable checkpoints, replay safety and reconciliation.
7. **Tests before claims:** every interesting engineering choice gets an invariant, a test scenario and a measurable result.
8. **Keep the initial implementation understandable:** no Kafka, Redis, Kubernetes, extra services or abstractions without a concrete need.
9. **Demo/live separation:** seeded data, fake payments and development users isolated from real environments.

## Architecture Diagram

```mermaid
flowchart TD
    UI["Next.js storefront (admin dashboard later)"]
    API["main.py / FastAPI routes"]
    MODELS["models.py / validation"]
    CAT["catalogue.py"]
    ORD["orders.py"]
    INV["inventory.py"]
    PAY["payments.py"]
    DB["db.py / transactions"]
    PG[("PostgreSQL: source of truth")]
    SCHEMA["db.sql / initial schema"]
    SEED["scripts/seed.py"]
    SYNC["analytics/sync.py"]
    DUCK["analytics/duck.py"]
    DDB[("DuckDB analytical state")]
    SALES["analytics/sales.py / pandas"]
    FORECAST["analytics/forecasting.py / NumPy"]
    CHARTS["analytics/charts.py / Matplotlib"]

    UI <-->|HTTP/JSON| API
    API --> MODELS
    API --> CAT
    API --> ORD
    API --> SALES
    API --> FORECAST
    API --> CHARTS
    ORD --> INV
    ORD --> PAY
    CAT --> DB
    ORD --> DB
    INV --> DB
    DB <--> PG
    SCHEMA -.->|setup| PG
    SEED --> DB
    PG -->|read committed changes| SYNC
    SYNC --> DUCK
    DUCK <--> DDB
    SALES --> DUCK
    FORECAST --> DUCK
    SALES --> CHARTS
    FORECAST --> CHARTS
```

## Decisions still to settle

- [x]  Table DDL, monetary amounts and VAT (see `docs/architecture.md`); refund accounting still open
- [x]  Direct SQL with psycopg 3
- [x]  Guest checkout with an idempotency key; reservations expire after `RESERVATION_HOLD_MINUTES` (default 15)
- [ ]  DuckDB storage mode: live Postgres queries, persisted snapshots or hybrid; thresholds for caching
- [ ]  Safe change-capture mechanism and checkpoint order (avoid losing late-committing changes)
- [x]  Storefront built after the core order logic
- [ ]  API chart format (JSON chart data versus generated PNG/SVG)
- [ ]  Authentication, deployment provider, real payment integrations (deferred)
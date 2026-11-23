# AGENTS.md: CommerceLab

CommerceLab is a learning project: an e-commerce system for an invented
computer, IT and office-equipment shop, built so it **feels completely real**.

- **Backend:** Python FastAPI, with PostgreSQL as the single source of truth.
- **Storefront:** Next.js, in `frontend/`. Built, on the `storefront` branch awaiting the owner's merge into `main`.
- **Later:** analytics over the same database (DuckDB and pandas).

The owner cares most about the design; the backend exists to give the design
real data.

## Where things are

| Path | What lives there |
|---|---|
| `commercelab/data/db.sql` | The whole schema. A dev script that drops and recreates every table |
| `commercelab/data/db.py` | Connections and the pool |
| `commercelab/domain/` | The rules: `catalogue`, `inventory`, `orders`, `payments`, plus `pricing`, `cart`, `customers`, `images` |
| `commercelab/api/` | HTTP only: `models.py` (the public contract), `routes/`, `errors.py` (exception → status) |
| `scripts/` | `seed`, `reconcile`, `reset_db`, `export_openapi`, `fetch_images` |
| `tests/` | Mirrors the packages. Shared rules in `tests/support/invariants.py`, builders in `tests/support/fakes.py` |
| `frontend/` | The Next.js storefront: `app/` routes, `lib/` pure logic, `e2e/` Playwright tests |
| `docs/architecture.md` | How the system works, as built. **Read before changing domain code** |
| `docs/superpowers/specs/` | Approved designs: what to build and why |
| `docs/superpowers/plans/` | Implementation plans, the execution record, `frozen-paths.txt` (retired) |

## Commands

```bash
uv sync                                   # install
uv run pytest -q                          # every test; needs local PostgreSQL 17
uv run ruff check .                       # lint
uv run python -m scripts.seed             # deterministic demo data (seed 42), APP_ENV=demo only
uv run uvicorn commercelab.main:app --reload
uv run python -m scripts.reconcile --dry-run
uv run python -m scripts.fetch_images     # stock photos into .cache/images (before reset_db)
uv run python -m scripts.reset_db         # dev/e2e database to seed 42; refuses unless demo and `commercelab` or `*_e2e`
uv run python -m scripts.export_openapi   # after any api/models.py change; a test enforces it
```

Frontend, from `frontend/` (`npm ci`, with `--cache /tmp/<dir>` if the default cache errors):

```bash
npm run dev          # API_URL=http://127.0.0.1:8000 by default, server-side only
npm test             # vitest unit tests
npm run typecheck    # regenerates lib/api-types.ts, fails if it changed, then tsc
npm run lint
npm run e2e          # real backend and its own database; E2E_DATABASE_URL, E2E_API_PORT, E2E_WEB_PORT for parallel runs
npm run gen:api      # openapi.json -> lib/api-types.ts
```

Tests use `commercelab_test`, which is created and rebuilt automatically. Its
name must end in `_test`. Settings come from the environment or `.env` (see
`.env.example`).

## Rules the code depends on

**Ownership:**
- **PostgreSQL is the single source of truth.** That covers products, stock, customers, orders, payments, and **image bytes** (content-addressed by sha256). There is no second store.
- **Business rules live in Python.** Prices, totals, VAT (`gross ÷ 6`, rounded half up), stock bands, quote clamping and order state are all computed in `commercelab/domain/`. The frontend renders what the API returns, and validates input only as a convenience.

**Data on the wire:**
- **Money** is `NUMERIC(12,2)` in GBP, tax-inclusive. It is a `Decimal` in Python and a **string** in JSON.
- **The public API exposes only customer-facing data.** Never `unit_cost`. Product responses show stock bands only, never the raw `available` count; the 409 stock error and the cart quote reveal how many can be bought (up to 100), by design. Orders are reached only by their `public_token`.

**Transactions and concurrency:**
- **The transaction rule.** Pooled connections run in autocommit. Domain functions take a `conn` and wrap their writes in `with conn.transaction():`. In tests, the `conn` fixture opens an outer `transaction(force_rollback=True)`, so those blocks become savepoints and nothing commits. See `docs/architecture.md` §3.
- **Check inside the change.** Concurrency is decided by the statement itself: `UPDATE … WHERE <condition> RETURNING`, `INSERT … ON CONFLICT`. Read-then-write is avoided. See §4.
- **Checkout.** The payment provider is called with **no transaction open**. A timeout is `unknown`, never `failed`. Retries reuse the idempotency key, and reconciliation asks with `lookup()`, never `charge()`. See §5.

**Repeatable results:**
- **Determinism.** The seed is reproducible from seed 42 with fixed dates. Sorting is locale-proof (`COLLATE "C"`, with an id tie-break).

## How work is done (process engineering)

Every feature moves through the same pipeline. The skills named are the
superpowers plugin's.

1. **Brainstorm** (`superpowers:brainstorming`): understand intent, show mockups, agree the approach.
2. **Spec**, in `docs/superpowers/specs/`: intent, goals, non-goals, anti-goals and decisions, with each decision marked as the owner's or the builder's call. A builder-check subagent reads it before the owner approves.
3. **Plan** (`superpowers:writing-plans`), in `docs/superpowers/plans/`: exact files, signatures and test names, and a Review Focus list. An independent cross-plan **contract check** runs before execution.
4. **Contract freeze**: one task fixes the schema, API models, routes, shared fixtures and `openapi.json`, so parallel streams never invent shapes.
5. **Streams**: parallel tasks on their own branches and sandboxes.
6. **Review**: a fresh reviewer per task, given the diff and the task, never the builder's summary.
7. **Merge gates**: the phase's full test command on the merged result.

How the code is written:
- **Test first.** Write the test, watch it go **red**, implement, then watch it go green.
- **Mutation-check the key mechanisms.** Break the code deliberately and confirm a test catches it. That's how idempotency, unknown-payment handling and reconciliation were proven.
- **Race tests force the worst-case timing.** They wait on `pg_stat_activity` until the second connection shows `wait_event_type = 'Lock'`. They don't sleep.
- **Shared invariants** (`assert_all_hold`) run after any test that changes stock, orders or payments.

What the owner decides:
- **Approval points:** the spec, the plans, the stock-photo contact sheet, and any merge into `main`.
- **Commits and pushes happen only when the owner asks.** Branch before committing on `main`. Agents never merge into `main`.
- **A contract problem** (schema, `api/models.py`, `openapi.json`) is fixed at the source and never worked around.

## History: how the storefront was built

The storefront was built in phases by parallel streams on `sf/<stream>` branches
under the `storefront` integration branch, with frozen contracts, per-stream
sandboxes, then native builds. None of that applies any more: the build is
merged and nothing is frozen. The full account is in
`docs/superpowers/plans/2026-11-21-storefront-execution.md`.

## Conventions

- **Tone of shop copy:** short, plain and confident. It promises only what the system does, so no confirmation emails and no delivery dates.
- **Brands are invented:** Halden, Marlow, Tessel, Kestrel, Aster, Orrin, Corda and Lumi. Stock photos come from Unsplash or Pexels, with their licence and credit recorded, and no visible real logos.
- **Research tools:** Firecrawl is for design research only. Use WebSearch and WebFetch for docs and facts, and `npm view` for package versions.

# CommerceLab containerisation implementation plan

> For agentic workers: use superpowers:subagent-driven-development to implement task by task. Check off verified steps.

**Goal** — After one verified transfer, the existing shop runs locally with `docker compose up` and retains progress across restarts.

**Architecture** — Next.js calls FastAPI over the Compose network. PostgreSQL holds the restored shop on a project-scoped volume. A read-only API preflight checks the schema before Uvicorn starts.

**Tech stack** — PostgreSQL 17, Python 3.14 with uv, Node 22 with npm, Next.js standalone output, Docker Compose.

**Spec** — [Approved containerisation design](../specs/2026-11-23-containerisation-design.md).

## Global constraints

Work on a feature branch after plan approval. Review each task with a fresh reviewer. Commit or push only on owner request. The owner merges. Keep native development and tests. Stop on external-drive I/O errors and report them. Leave the retired sandbox in place. Ordinary startup must never seed, download images, reset or repair the shop. Cutover and disposable verification have distinct targets.

## Review focus

1. Missing relations, including a partial restore, must block startup even if PostgreSQL answers a ping.
2. A valid shop with zero products must start.
3. Native defaults and host environment variables must never redirect Compose writes to the wrong database.
4. Smoke tests must coexist with the normal stack and remove only their own resources.
5. Recreating containers must preserve a newly purchased order, its stock change and photos.

## Task 1 — Freeze the read-only startup contract

**Create** `scripts/check_shop_schema.py` and `tests/scripts/test_check_shop_schema.py`. Reuse `commercelab.data.db.connect()`. The existing HTTP contract, SQL schema and health endpoint already serve this design.

- [x] Write `test_complete_schema_with_empty_catalogue_passes`, `test_missing_schema_requests_restore` and `test_partial_schema_names_missing_relations`. Use the rollback connection fixture, establish each schema state within it, and assert respectively an empty tuple, all required names, and only the removed names. Include the availability view and a same-named object outside public in the failure cases. Exercise the CLI error path and assert nonzero exit and actionable restore text. Run `uv run pytest -q tests/scripts/test_check_shop_schema.py` and observe failure.
- [x] Implement `missing_relations(conn: psycopg.Connection) -> tuple[str, ...]` and `main() -> None`. Compare expected relation names and kinds from db.sql (15 tables and product_availability view) against PostgreSQL catalogue metadata for public. Sort missing names. Never inspect product counts. Use a standalone connection and emit a short restore instruction on missing relations. Distinguish connection failure without printing credentials.
- [x] Re-run the tests and Ruff. Temporarily reduce the check to a ping, confirm the partial-schema test fails, and revert the mutation. Freeze the integration command `python -m scripts.check_shop_schema`.

## Task 2 — Package and start the existing services

**Create** `Dockerfile`, `.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `compose.yaml`. **Modify** `frontend/next.config.ts` and `.env.example`. Consume Task 1's CLI. Expose service names db, api and web, and project-scoped volume pgdata to Task 3.

- [x] Before implementation, exercise `docker compose config --quiet` with the intended file and record the missing-config failure. Select and verify exact compatible multi-architecture image tags for PostgreSQL 17, Python 3.14, uv and Node 22. Record the resolved pins directly in the build files.
- [x] Use root and frontend build contexts respectively. Install locked Python production dependencies with frozen uv and npm packages with npm ci. Read the installed Next standalone guide before editing. Build once, ship standalone server.js plus .next/static and public assets if present (this checkout has no public directory). Retain the root working directory expected by Python. Use build context allowlists for required inputs, excluding .env files, dumps, virtual environments, local build output, test artifacts and the retired sandbox.
- [x] Configure db on internal port 5432 with a project-scoped volume and pg_isready health check. Require a locally supplied password. Fix the service-side DATABASE_URL to postgresql://commercelab@db:5432/commercelab. Pass the same required COMMERCE_DB_PASSWORD value as POSTGRES_PASSWORD on db and PGPASSWORD on api. Set POSTGRES_USER and POSTGRES_DB to commercelab. Document local hex password generation and verify authentication. Keep credentials out of build args, output and tracked files.
- [x] Gate api on healthy db. Run the schema CLI and only on success exec Uvicorn at 0.0.0.0:8000. Gate web on a successful HTTP /health from the API. Set HOSTNAME=0.0.0.0, PORT=3000 and server-only API_URL=http://api:8000 in web. Bind host ports to 127.0.0.1 with overridable API_HOST_PORT and WEB_HOST_PORT, defaults 8000 and 3000. Allow 0 for Docker-assigned smoke ports. Set limits db/api/web to 1 GiB/512 MiB/512 MiB and one CPU each. Pass through demo settings with defaults demo, 1–10 pool connections, 15 minutes, 5% declines.
- [x] Validate rendered configuration with synthetic inputs including a deliberately irrelevant native DATABASE_URL. Check internal target, bindings, startup order, project-scoped storage and caps. Build both images. Start a unique disposable project with empty db, confirm api exits with restore guidance and web never becomes ready. Review this task before integrated verification.

## Task 3 — Prove persistence and document cutover

**Create** `scripts/compose_smoke.sh`. **Modify** `README.md`, `docs/architecture.md`. Consume Task 2's service names, ports and volume. Reuse the seed's existing synthetic-image mode only in disposable fixture preparation.

- [x] Start the smoke harness from a clean unique project name and private temporary directory. Supply a synthetic password, zero declines and dynamic loopback ports. Use explicit project and Compose file on every command, resolve published ports after each up, bound readiness waits, and scope teardown to that project. Run it first against the empty database and observe the expected readiness failure.
- [x] Construct a separate scratch database inside that disposable db service, apply db.sql there, and load seed 42 using a one-off container from the API image with read-only mounts of scripts/ and commercelab/data/db.sql beneath the repo-root working directory, including the catalogue modules and image manifest. Call seed.write(conn, *seed.generate(42)) directly; the seed CLI requires cached photos. Use an explicit scratch connection and demo environment. Verify current_database() equals the unique scratch database name before seed.write and wrap all fixture writes in one transaction. Dump the scratch database in custom format and restore into the fresh smoke application database with pg_restore --single-transaction --exit-on-error --no-owner --no-acl. Keep fixture generation outside normal startup. Check the target is empty before restore.
- [x] Start the stack. Assert HTTP 200 and expected content for /, /p/{slug}, and /media/{key}. Choose a stocked fixture item and check returned media bytes against its SHA-256 key. POST /api/checkout on web with an Idempotency-Key and the contact/address/items shape in frontend/e2e/support.ts. Read product_availability.available in the disposable database immediately before the POST and again afterward. Assert paid status and the exact decrement by ordered quantity. Record the returned token, ordered lines and post-checkout stock. Sample docker stats for the three service containers. Down and up again, rediscover ports, and retrieve GET /orders/{token} on api. Assert identical items, retained stock change and identical media bytes. Report measured memory and successful cleanup.
- [x] Document host port conflicts, credential setup, initial restore, readiness errors, ordinary down/up, and the data loss from down -v. Supply copyable PostgreSQL 17 commands for stopping writers, taking a private custom dump outside the repo, starting db alone, checking an empty target, restoring atomically, and comparing ordered verification queries on native and Compose databases. Compare counts and order totals, per-product stock, and image keys and computed content hashes. Keep source and dump. Switchover is a distinct operator step after verification and review.
- [x] Rehearse the documented restore and comparison on the synthetic fixture. Run scripts/compose_smoke.sh; verify another project's volume and containers remain intact. Run native backend pytest and Ruff, then frontend npm test, npm run typecheck, npm run lint, npm run build and npm run e2e using the documented isolated test databases and cached images. Record actual results, service memory samples and any unverified conditions before branch review.


## Verification record

The disposable transfer matched product, order and image counts, order totals by status, per-product inventory and image hashes. Checkout reduced the selected SKU from 9 available units to 7. The same order, stock and synthetic image bytes survived container recreation. Cleanup preserved a sibling project's database container and volume. A simulated service-log I/O failure also preserved the failing project for diagnosis.

| Service | Memory sampled after checkout | Configured ceiling |
|---|---:|---:|
| PostgreSQL | 53.46 MiB | 1 GiB |
| FastAPI | 77.05 MiB | 512 MiB |
| Next.js | 163.6 MiB | 512 MiB |

Native results: 361 backend tests, 101 frontend unit tests and 91 Playwright tests passed. The first Playwright run returned 90/91 after a mobile control measured 43.999985 pixels against a 44-pixel threshold. The entire suite passed on rerun. Ruff, frontend lint, typecheck and the production build passed. Package installation reported four moderate advisories in the existing npm dependency tree. Live transfer is an operator step after branch review.

After the smoke project had been removed and sibling isolation verified, Docker reported an input/output error while removing the separate commercetask2-web-1 validation container. Docker operations stopped there. Cleanup of that project's containers, images and volume is unconfirmed. The native shop database was never transferred.

# Handover: containerise CommerceLab (one-command run)

**Date:** 23 November 2026.

**State:** the design is proposed and **not yet approved by the owner**. Nothing has been built yet.

**For:** the next session or agent picking this up. Read `AGENTS.md` first. It holds the project rules and how work is done here.

## 1. What the owner wants, and why

The owner wants to **run the whole shop with one command**, on their own Mac:
- **The command:** `docker compose up`
- **Then:** open http://localhost:3000

That's the whole goal. The spec still says the shop runs **locally only**, so deployment, hosting and HTTPS stay out of scope.

The owner's standing rule (in memory, 23 November 2026): **build and test natively during development, and containerise afterwards as a separate step.** So this is packaging the finished app. It isn't a development environment, and it doesn't replace the native test workflow.

## 2. Where things stand

- **`main` (`25e03eb`, pushed)** holds the finished storefront:
  - FastAPI backend: `commercelab/`
  - Next.js 16 shop: `frontend/`
  - PostgreSQL 17 schema: `commercelab/data/db.sql`
  - Scripts: `scripts/`
- **All suites pass natively:** 357 backend tests, 101 frontend unit tests, and 91 Playwright tests (including the backend-down project).
- **How it runs today, natively** (see `README.md` and `docs/architecture.md` §7–8):
  1. `uv run python -m scripts.fetch_images` downloads 71 stock photos into `.cache/images/`. It needs the internet, and checks each file against its sha256.
  2. `uv run python -m scripts.reset_db` applies the schema and seeds deterministic data, including the image bytes, into PostgreSQL.
  3. `uv run uvicorn commercelab.main:app` starts the API on port 8000.
  4. In `frontend/`, `npm run build && npm run start` serves the shop on port 3000, with `API_URL` pointing at the API.
- **`dev/sandbox/`** (Dockerfile, entrypoint, run.sh) is the **retired** per-stream *test* sandbox from Phases 0–1. It's one 2.6 GB image with every tool in it, and it isn't something to ship. The proposal deletes it.

## 3. Facts the build depends on

| Fact | Where | Consequence |
|---|---|---|
| `reset_db` **always drops and recreates** every table | `scripts/reset_db.py` | "Seed only on the first run" needs a guard, for example a new `--if-empty` flag that skips the reset when `products` already has rows. Add it test-first in `tests/scripts/test_reset_db.py` |
| `reset_db` refuses unless `APP_ENV=demo` **and** the database is named `commercelab` or ends in `_e2e` | `reset_db.allowed` | Call the compose database `commercelab` |
| `reset_db` checks **every** manifest image is cached before touching the database | `reset_db.main` | `fetch_images` must run first, with the cache on a volume |
| `CACHE_DIR = Path(".cache/images")` and `MANIFEST_PATH = Path("scripts/image_manifest.json")` are **relative** paths | `scripts/image_manifest.py` | The scripts must run with the repo root as the working directory (`WORKDIR` = repo root) |
| Backend settings come from the environment | `commercelab/config.py`, `.env.example` | `DATABASE_URL`, `APP_ENV`, `DB_POOL_MIN`, `DB_POOL_MAX`, `RESERVATION_HOLD_MINUTES`, `SIMULATED_DECLINE_PERCENT` |
| uvicorn binds to 127.0.0.1 by default | — | Inside a container it needs `--host 0.0.0.0` |
| The shop reads `API_URL` **on the server only**, through `lib/api.ts` (`server-only`) and the three route handlers. The browser never sees it | `frontend/` | Set `API_URL=http://api:8000` on the web container. Only port 3000 needs exposing to the Mac |
| `next.config.ts` has no `output: "standalone"` | `frontend/next.config.ts` | Either add standalone output (a smaller image) or ship `node_modules` with `next start`. Fonts are self-hosted, so the build needs no network |
| Python ≥ 3.14 managed by uv, with `uv.lock` committed; Node 22 with `package-lock.json` (exact pins) | `pyproject.toml`, `frontend/` | Use `uv sync --frozen --no-dev` and `npm ci`. Pin image tags exactly, as the project pins everything |
| The npm cache on the external drive misbehaved during the build | host only | Not a container problem. Use `npm ci --cache /tmp/...` on the host if it recurs |

## 4. Proposed design (not yet approved)

Use **Docker Compose** with four services:

| Service | Image | Does | Notes |
|---|---|---|---|
| `db` | `postgres:17` (pinned) | Holds all data, including image bytes | Named volume for the data; `pg_isready` health check |
| `seed` | the API image | Runs once, then exits: `fetch_images` (into a named volume mounted at `.cache/images`), then `reset_db --if-empty` | Needs the internet on the first run only. Waits for `db` to be healthy |
| `api` | slim Python 3.14 + uv, multi-stage | `uvicorn commercelab.main:app --host 0.0.0.0 --port 8000` | Starts after `seed` completes successfully. Not published to the Mac |
| `web` | slim Node 22, multi-stage, production build | `next start` on 3000 with `API_URL=http://api:8000` | The only published port: 3000 |

**Behaviour:**
- **Starting and stopping:** `docker compose up` builds the images and starts everything; open http://localhost:3000. Data persists between runs.
- **Resetting:** `docker compose down -v` wipes the data and the photo cache. The next `up` reseeds from scratch.
- **Demo settings:** `APP_ENV=demo`, and `SIMULATED_DECLINE_PERCENT` defaults to 5 (overridable in `.env`).

**Proof that it's done:**
- `scripts/compose_smoke.sh` brings the stack up from nothing and waits for health.
- It checks that the home page, a product page and a `/media/<key>` photo all return 200, and that a test checkout through the shop's `/api/checkout` returns an order.
- It then tears the stack down with `-v`.

**The builder's calls (state them in the design doc):**
- Dockerfile locations, for example `Dockerfile` at the root for the API and `frontend/Dockerfile` for the web.
- Standalone output or not.
- A `.dockerignore` that keeps out `.venv`, `node_modules`, `.next`, `.cache`, `.superpowers` and `.claude`.
- Deleting `dev/sandbox/`.

**Out of scope:** deployment, HTTPS, hot-reload development containers, running the test suites in containers, and replacing the native workflow.

## 5. Risks and gotchas

- **Docker's disk lives on the external LaCie USB drive** (`/Volumes/LaCie/Docker-Desktop-Data`):
  - On 23 November 2026, its VM disk went read-only twice under heavy parallel load (seven containers installing npm packages and running Chromium).
  - The disk was reset and the old file deleted.
  - Four light, prebuilt services should be fine.
  - If I/O errors appear, stop, tell the owner, and don't keep retrying. The Mac has `disksleep 10`; the owner was advised to run `sudo pmset -a disksleep 0`.
- **Docker Desktop resources:** about 10 GB of memory and 8 CPUs, set in `~/Library/Group Containers/group.com.docker/settings-store.json`.
- **GitHub:** the active `gh` account must be **0xEl1yahu** to push to `0xEl1yahu/commercelab`.
- **Branching:** don't commit on `main`. Branch first (for example `containerise`). Commit and push only when the owner asks.

## 6. Next steps

1. **Get the owner's approval** of §4. Ask whether anything in it should change: the seed-once behaviour, the one published port, or deleting `dev/sandbox/`.
2. **Write the short design doc:** `docs/superpowers/specs/2026-11-23-containerisation-design.md`, built from §1, §4 and §5. Mark the builder's calls as such.
3. **Plan it** with `superpowers:writing-plans`. Expect about three tasks:
   1. `reset_db --if-empty`, test-first.
   2. The two Dockerfiles, `.dockerignore` and `compose.yaml`.
   3. `compose_smoke.sh` plus README and architecture-doc updates.
4. **Build on a branch.** Prove it with a clean run of `compose_smoke.sh`, then run the native suites to confirm nothing regressed.
5. **Review, then the owner merges.**

## 7. Read first

- `AGENTS.md`
- `README.md` ("Running it on a Mac")
- `docs/architecture.md` §7–8
- `.env.example`
- `scripts/reset_db.py`, `scripts/fetch_images.py` and `scripts/image_manifest.py`
- `frontend/next.config.ts` and `frontend/package.json`
- `frontend/playwright.config.ts`: its `webServer` commands are a working recipe for starting the stack
- `dev/sandbox/Dockerfile`: a reference only, for installing PostgreSQL 17, uv and Node

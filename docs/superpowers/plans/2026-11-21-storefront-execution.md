# Storefront Execution Arrangement: Frozen Contracts, Parallel Streams

How the backend and frontend plans are built in parallel by several agents
without stepping on each other.

- Task definitions: `2026-11-21-storefront-backend.md` (B0–B7) and `2026-11-21-storefront-frontend.md` (F0–F5).
- This document decides the branches, order, isolation, models, effort and merge gates.

## 1. Branches

```
main
 └─ storefront                  integration branch: frozen contracts, then merged streams
     ├─ sf/b-seed        (B1)   ┐
     ├─ sf/b-images      (B2)   │
     ├─ sf/b-catalogue   (B3)   │ Phase 1
     ├─ sf/b-cart        (B4)   │
     ├─ sf/b-checkout    (B5)   │
     ├─ sf/b-tooling     (B6)   │
     ├─ sf/f-contracts   (F0)   ┘ merges last in Phase 1
     ├─ sf/f-home        (F1)   ┐
     ├─ sf/f-listing     (F2)   │
     ├─ sf/f-product-bag (F3)   │ Phase 2
     ├─ sf/f-checkout    (F4)   │
     └─ sf/f-pages       (F5)   ┘
```

- **`storefront` is the integration branch.** `main` is untouched until the owner merges `storefront` into it at the end.
- **Stream branches use `sf/`.** Git can't hold both a `storefront` branch and `storefront/x` branches.
- **Each stream is cut from `storefront`** at the start of its phase, and runs in its own git worktree at `../commercelab-worktrees/<branch>`.

## 2. Phases

| Phase | Runs | Content | Gate to the next phase |
|---|---|---|---|
| **0. Contract freeze** | 1 agent, on `storefront` | B0 | `uv run pytest -q` is green, with only the `xfail(strict)` markers B0 lists; `ruff` is clean; `openapi.json` is current. **The owner approves the freeze diff.** |
| **1. Backend streams, plus the frontend contracts** | 7 agents in parallel | B1–B6, F0 | Every stream is merged, F0 last after rebasing. On `storefront`: `uv run pytest -q` with **no xfail markers left**; `ruff`; `scripts.reset_db` against an `_e2e` database; `openapi.json` unchanged since Phase 0. In `frontend/`: `npm test`, `npm run typecheck`, and `npm run e2e -- shell.spec.ts` |
| **2. Frontend streams** | 5 agents in parallel | F1–F5 | Every stream is merged. On `storefront`: the full Playwright suite, both projects, plus Vitest, typecheck and lint |
| **3. Close-out** | 1 agent, then the whole-branch review | B7 docs; **B2 must be merged**, so no image test is skipped (`npm run e2e` reports 0 skipped); the final review | The owner merges into `main` |

**Why the frontend screens wait for Phase 1:**
- Their e2e tests drive the real backend. A mock API would re-implement filtering, quote clamping and checkout states a second time, which the spec rules out.
- F0 can run in Phase 1 because it needs only B0's frozen `openapi.json`. Its shell e2e needs B6's `reset_db`, so it merges last.

**B2's owner-approval wait doesn't block Phase 2.** Until B2 merges, products have no images: tiles show the fallback, and the image-dependent tests skip with a reason. Phase 3 requires them to run.

## 3. What is frozen

`docs/superpowers/plans/frozen-paths.txt` is written by B0 and extended by F0 with its own sections. It has three sections:

| Section | Rule | Contents |
|---|---|---|
| `[frozen]` | No stream may change these | Schema; API models, routes and error mappings; `pricing.py`; `images.py`; `catalogue_data.py`; `image_manifest.py`; `fakes.py`; `conftest.py`; settings and dependencies; `export_openapi.py`; `openapi.json`. Frontend: scaffold, `package.json` and lockfile, tokens, `layout.tsx`, `lib/api.ts`, `lib/api-types.ts`, `lib/types.ts`, `lib/money.ts`, `lib/cart.ts`, the cart provider and bag button, the shell, the shared product components, `components/ui/`, the three route handlers, and the Playwright and Vitest configs with `e2e/support.ts` |
| `[signatures]` | Bodies may change; declared names, parameters, return types, TypedDicts, dataclasses and constants may not | The names B0 declares in `catalogue.py`, `cart.py`, `customers.py` and `orders.py`. Other functions in those files belong to the owning stream |
| `[stubs]` | Exists only so imports resolve; the owning stream implements it | `frontend/components/cart/bag-drawer.tsx` (F3) |

Rules for streams:

1. **Frozen means frozen.** At merge, `git diff storefront...sf/<name> -- <[frozen] paths>` must be empty. The reviewer checks the `[signatures]` files by eye.
2. **A contract problem stops the stream.** The agent reports it and doesn't work around it. The coordinator fixes it on `storefront` (regenerating `openapi.json` and `lib/api-types.ts` if the models change), and every open stream rebases. That is the only way frozen files change after Phase 0.
3. **Each stream owns distinct files.** Shared test files are split by task as listed in the plans. `test_dependencies.py` belongs to B0, `test_catalogue*.py` to B3, `test_order_routes.py` and `test_orders.py` to B5, `test_seed.py` to B1, and `test_image_manifest.py` to B2.
4. **Merge as soon as a stream passes its review and its tests:** `git merge --no-ff sf/<name>` into `storefront`, then the phase's full test command on the result. The last stream to merge in a phase runs the phase gate. In Phase 1, **B1 merges before B6 runs end to end**, because `reset_db` calls `seed.write(..., image_bytes=...)`, which B1 adds. B6's own unit tests don't depend on it.
5. **Agents never merge into `main`, and never push without the owner's say-so.**

## 4. Where streams run: hybrid (owner's decision)

| Work | Runs in | Limits |
|---|---|---|
| Phase 0 (B0), and the Phase 1 backend streams B1–B6 | **Local Docker**, one container per stream | `--memory 1g --memory-swap 1g --cpus 1` |
| F0 (frontend contracts) | Local Docker | `--memory 3g --memory-swap 3g --cpus 2` |
| Phase 2 frontend streams F1–F5 | **Claude Code cloud sessions** (`claude --cloud`), one per stream | One VM each, about 4 vCPU, 16 GB RAM and 30 GB disk, fixed by the platform |
| Merge gates, reviewer test runs and the Phase 3 checks | Local Docker, one at a time, in the integration container `cl-storefront` | `--memory 4g --memory-swap 4g --cpus 4` |

### Local containers

- **Agents run on the Mac.** They edit files in their worktree. **Every test, seed and server command runs inside the stream's container,** through `docker exec cl-<stream> bash -lc "<command>"`.
- **The image is `dev/sandbox/Dockerfile`,** written in Phase 0 by B0 and frozen. It contains:
  - Ubuntu 24.04
  - PostgreSQL 17 (PGDG apt)
  - uv with Python 3.14
  - Node 22
  - Playwright 1.65.1 Chromium and its system dependencies

  Its entrypoint starts PostgreSQL and creates a `commercelab` role with trust auth on localhost.
- **`dev/sandbox/run.sh <stream> <memory> <cpus>`** starts `cl-<stream>` detached. It:
  - mounts the worktree at `/work` and the main checkout's `.cache/images` at `/work/.cache/images`
  - puts `/work/.venv` and `/work/frontend/node_modules` on per-stream named volumes, because macOS-built binaries don't run in Linux
  - sets `--memory`, `--memory-swap` (equal to `--memory`, so the container gets no swap) and `--cpus`
- **Isolation comes from the container.** Each one has its own PostgreSQL on its own localhost, so every stream uses the default names: `commercelab_test`, `commercelab_e2e`, ports 8100 and 3100. The old table of per-stream databases and ports is gone.
- **Concurrency on this Mac** (16 GB RAM, 10 cores): at most 6 backend containers (6 GB) plus F0 (3 GB) at once. Docker Desktop is given 10 GB and 8 CPUs.
- **The integration container `cl-storefront`** runs on the main checkout. Merge gates and reviewers run their tests there, one at a time.
- **The dev database `commercelab` on the Mac is never used by agents.**

### Cloud sessions (Phase 2)

- **Setup:** the coordinator pushes `storefront` and each `sf/f-*` branch, then runs `claude --cloud "<task prompt>"` from that branch's checkout. A session clones the pushed branch, and **results come back as pushes to that branch**. There's no completion notification, so the coordinator checks with `git fetch` on a schedule, then reviews and gates locally in `cl-storefront`.
- **The cloud environment, set once at claude.ai/code by the owner:**
  - **Setup script:** install PostgreSQL 17 (PGDG), run `npx playwright@1.65.1 install --with-deps chromium`, and `uv python install 3.14`. Keep it under about 5 minutes so the environment is cached. Each session starts PostgreSQL itself (`service postgresql start`), because background processes don't survive the snapshot.
  - **Network:** Limited, with package managers allowed, plus `unsplash.com`, `*.unsplash.com`, `pexels.com` and `*.pexels.com` for `fetch_images`.
  - **Environment variable:** `BASH_DEFAULT_TIMEOUT_MS=600000`, because a Next.js build plus Playwright exceeds the 2-minute default.
- **Unverified:** whether a cloud session's model and effort can be set per session. If they can't, Phase 2 builders run on the account's default model, and section 5's Phase 2 rows become a recommendation. The local reviewers keep their assignments.

### Owner prerequisites

| When | Action |
|---|---|
| Before Phase 0 | **Done.** Docker Desktop is running with 10 GB of memory (9.7 GiB usable) and 8 CPUs |
| Before Phase 0 | **Done, and not a constraint.** Docker's data lives on the external LaCie drive (about 790 GB free). The Mac's internal disk only holds the stream worktrees, which are small |
| Before Phase 2 | Approve pushing `storefront` and `sf/f-*` to the public GitHub repo |
| Before Phase 2 | Set up the cloud environment as above |

## 5. Agents: model and effort

| Work | Builder | Effort | Reviewer (a fresh agent; gets the diff and the task, not the builder's summary) |
|---|---|---|---|
| B0 contract freeze | Opus 5.5 | high | Opus 5.5, high |
| B1 seed content (55 products of copy, determinism) | Sonnet 5.5 | medium | Sonnet 5.5, medium |
| B2 stock photography (curation, licences, owner approval) | Sonnet 5.5 | medium | the owner approves the contact sheet; Sonnet 5.5, low checks the manifest and tests |
| B3 catalogue (filter SQL, totals, facets) | Sonnet 5.5 | high | Sonnet 5.5, high |
| B4 cart quote | Sonnet 5.5 | medium | Sonnet 5.5, medium |
| B5 guest checkout (idempotency hash, race test) | Opus 5.5 | high | Opus 5.5, high |
| B6 reset_db (destructive script with a safety guard) | Haiku 5.5 | medium | Sonnet 5.5, low |
| F0 frontend contracts (everything F1–F5 import) | Opus 5.5 | high | Opus 5.5, medium |
| F1 home (sets the visual bar) | Opus 5.5 | medium | Sonnet 5.5, medium |
| F2 listing (URL state, filter bar) | Sonnet 5.5 | high | Sonnet 5.5, medium |
| F3 product page and drawer | Sonnet 5.5 | high | Sonnet 5.5, medium |
| F4 checkout (outcome state machine, retries, race e2e) | Opus 5.5 | high | Opus 5.5, high |
| F5 confirmation, errors and copy | Sonnet 5.5 | medium | Sonnet 5.5, low |
| B7 docs | Sonnet 5.5 | low | — |
| Whole-branch review before merging into `main` | — | — | Opus 5.5, high |

How the models were chosen:
- **Opus high:** where a mistake costs money, breaks idempotency, or freezes a wrong contract for every other stream.
- **Opus medium on the home page:** it sets the visual standard the owner cares most about.
- **Sonnet:** most feature work, at high effort where the state or SQL rules are subtle.
- **Haiku:** mechanical, well-specified work.

Each builder gets:
- its task text, this document, the spec and `frozen-paths.txt`
- its container name (`cl-<stream>`) for local streams, or its pushed branch for cloud streams

## 6. What the owner approves, and when

1. These documents, before Phase 0 starts.
2. The Phase 0 freeze diff, before stream branches are cut.
3. B2's contact sheet of stock photos, before the manifest is committed.
4. Merging `storefront` into `main`, and any push.

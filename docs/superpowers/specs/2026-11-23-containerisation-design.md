# Run CommerceLab locally with Docker Compose

23 November 2026 · Approved by owner

## Intent and scope

**Owner decision.** Package the finished shop for the owner's Mac. After one transfer of the existing shop database, start it with `docker compose up` and open `http://localhost:3000`. Orders, stock changes and photos must survive container recreation. Development and the full test suites continue to run natively. Hosting, HTTPS, development containers and database schema migrations are outside this change.

## Approach

**Owner direction.** The handover proposed fetching photos and conditionally seeding a demo database. The revised approach carries the existing PostgreSQL database into a named volume. Row counts never trigger initialisation. Normal startup only reads the database until the application receives work. Calling reset, seeding, downloading photos or silently repairing a partial database during startup would violate the design.

**Owner direction.** Keep the existing request path from browser to Next.js to FastAPI to PostgreSQL. Publish the storefront and API on Mac loopback ports 3000 and 8000 respectively. PostgreSQL is reachable inside Compose on port 5432. Stock, pricing and checkout rules stay in Python.

## Runtime and packaging

**Builder decisions.** Use three services with these initial runtime ceilings. Measure actual use during the smoke test.

| Service | Runtime and connection | Memory | CPUs |
|---|---|---:|---:|
| db | PostgreSQL 17 with a project-scoped named data volume | 1 GiB | 1 |
| api | Python 3.14, locked production packages, Uvicorn listening on all container interfaces, DATABASE_URL targeting db | 512 MiB | 1 |
| web | Node 22 production build, server-side API_URL=http://api:8000 | 512 MiB | 1 |

Use a root API Dockerfile and a frontend Dockerfile, exact image version pins, and separate build stages. Use Next.js standalone output and include its static assets and public files. Exclude local credentials, dumps, caches, installed dependencies and development artifacts from build contexts. Supply the database password through local environment configuration. Retain the existing demo defaults of 1–10 pooled connections, a 15-minute stock hold and 5% simulated declines. Keep the retired sandbox outside the build. Its deletion requires a separate owner decision.

**Builder decision.** Start PostgreSQL first and wait for its connection health check. At API startup in Compose, perform a read-only check for the application's required tables in the expected schema. Accept a complete schema with zero products. On missing tables, exit with a restore instruction and keep the web service from starting. Use the existing API health endpoint to gate web startup after the schema check succeeds.

## One-time transfer and daily use

**Builder procedure.** Stop native shop writers at switchover. Create a local custom-format dump of the native database and keep it outside the repository. Start only the Compose database, confirm the target has no application objects, and restore with a single transaction, stopping on error. Map ownership to the Compose database user. Verify order counts and totals, stock quantities and image keys and bytes against the stationary source before directing normal traffic to the copy. Keep the original database and dump. After cutover the Compose database receives all new writes.

Use ordinary `docker compose down` to stop. Volume removal deletes the live copy. Keep smoke-test teardown isolated by project, volume and host ports. If the external Docker disk reports I/O errors, stop and report them to the owner.

## Acceptance and delivery

**Builder verification.** Exercise missing and partial schema failures and an empty catalogue with a complete schema. On a unique disposable Compose project, restore a deterministic synthetic fixture with products, stock and an image. Set payment declines to zero in this project. Check the home page, product page and photo, check out through Next.js, then take the stack down and bring it back up with the same volume. Retrieve the same order by token and verify its ordered items. Record service memory use. Clean up only the disposable project.

Run the backend, frontend and browser suites natively. Document first-time transfer, readiness errors, ports, stop/start commands and volume lifetime in the README and architecture guide. The owner approves the spec and implementation plan, requests any commits or pushes, and controls the merge into main.

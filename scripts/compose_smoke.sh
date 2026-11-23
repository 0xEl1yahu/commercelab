#!/usr/bin/env bash
# Rehearse a shop transfer and container recreation with disposable data.
set -euo pipefail
umask 077

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
project="commercelab-smoke-$(openssl rand -hex 8)"
scratch_db="smoke_source_${project##*-}"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/commercelab-smoke.XXXXXXXX")
touch "$work_dir/compose.env"

export COMMERCE_DB_PASSWORD API_HOST_PORT=0 WEB_HOST_PORT=0
export APP_ENV=demo DB_POOL_MIN=1 DB_POOL_MAX=10
export RESERVATION_HOLD_MINUTES=15 SIMULATED_DECLINE_PERCENT=0
COMMERCE_DB_PASSWORD=$(openssl rand -hex 24)
unset COMPOSE_PROFILES COMPOSE_ENV_FILES

fail() {
    printf 'Smoke failed: %s\n' "$*" >&2
    exit 1
}

# Check Docker diagnostics before issuing another Docker command. Keep the
# marker on disk so detection also survives a command substitution subshell.
docker_checked() {
    local status=0
    [[ ! -e "$work_dir/disk-error" ]] || return 1
    docker "$@" 2>"$work_dir/docker.stderr" || status=$?
    cat "$work_dir/docker.stderr" >&2
    if grep -Eiq 'input/output error|I/O error' "$work_dir/docker.stderr"; then
        touch "$work_dir/disk-error"
        fail "Docker reported an I/O error"
    fi
    return "$status"
}

compose() {
    docker_checked compose --project-name "$project" --file "$repo_root/compose.yaml" \
        --env-file "$work_dir/compose.env" "$@"
}

cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$status" != 0 && ! -e "$work_dir/disk-error" ]]; then
        # Compose may report only an unhealthy dependency while PostgreSQL logs
        # the underlying disk failure. Preserve the project in that case.
        compose logs --no-color >"$work_dir/services.log" || true
        if grep -Eiq 'input/output error|I/O error' "$work_dir/services.log"; then
            echo "A service reported a disk I/O error. Preserving the project and its logs." >&2
            touch "$work_dir/disk-error"
        fi
    fi
    if [[ ! -e "$work_dir/disk-error" ]] && compose down --volumes --rmi local; then
        rm -f "$work_dir/"*
        rmdir "$work_dir"
        printf 'Removed smoke project %s and its temporary files.\n' "$project"
    else
        printf 'Cleanup stopped for project %s. Diagnostics retained in %s.\n' \
            "$project" "$work_dir" >&2
        status=1
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sql() {
    local database=$1
    shift
    compose exec -T db psql -X -v ON_ERROR_STOP=1 -U commercelab -d "$database" "$@"
}

require_empty_target() {
    local relations
    relations=$(sql commercelab -At -c "
        SELECT count(*) FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public';
    ")
    [[ "$relations" == 0 ]] || fail "restore target is not empty"
}

http_status() {
    local expected=$1 output=$2 status
    shift 2
    status=$(curl -q --silent --show-error --max-time 10 --noproxy '*' \
        --output "$output" --write-out '%{http_code}' "$@")
    [[ "$status" == "$expected" ]] || fail "expected HTTP $expected, received $status for ${*: -1}"
}

published_url() {
    local binding
    binding=$(compose port "$1" "$2")
    [[ "$binding" =~ ^127\.0\.0\.1:[1-9][0-9]*$ ]] || fail "unexpected published $1 address: $binding"
    printf 'http://%s\n' "$binding"
}

start_shop() {
    local status deadline
    compose up --no-build --wait --wait-timeout 90
    api_url=$(published_url api 8000)
    web_url=$(published_url web 3000)
    http_status 200 "$work_dir/health.json" "$api_url/health"

    # Compose waits for web to be running. Next may still be starting its listener.
    deadline=$((SECONDS + 30))
    while (( SECONDS < deadline )); do
        status=$(curl -q --silent --max-time 2 --noproxy '*' \
            --output "$work_dir/home.html" --write-out '%{http_code}' "$web_url/") || status=000
        [[ "$status" == 200 ]] && return
        sleep 1
    done
    fail "web did not serve its home page within 30 seconds (last HTTP status $status)"
}

printf 'Checking empty schema startup in %s.\n' "$project"
compose build api web
if compose up --no-build --wait --wait-timeout 90; then
    fail "empty database allowed the stack to become ready"
fi
compose logs --no-color api >"$work_dir/empty-api.log"
if grep -Eiq 'input/output error|I/O error' "$work_dir/empty-api.log"; then
    touch "$work_dir/disk-error"
    fail "API reported an I/O error"
fi
if ! grep -qi 'restore' "$work_dir/empty-api.log"; then
    cat "$work_dir/empty-api.log" >&2
    fail "API did not report restore guidance"
fi
exited_api=$(compose ps --all --status exited --quiet api)
running_web=$(compose ps --status running --quiet web)
[[ -n "$exited_api" ]] || fail "API did not exit"
[[ -z "$running_web" ]] || fail "web started against empty schema"
printf 'Empty schema blocked API startup and kept web stopped.\n'

# This is the data source for the transfer rehearsal. Apply the destructive
# schema script only to the newly created scratch database.
printf 'Creating the seed-42 fixture in %s.\n' "$scratch_db"
compose exec -T db createdb -U commercelab -- "$scratch_db"
sql "$scratch_db" <"$repo_root/commercelab/data/db.sql"
compose run --rm --no-deps -T --entrypoint python \
    --volume "$repo_root/scripts:/app/scripts:ro" \
    --volume "$repo_root/commercelab/data/db.sql:/app/commercelab/data/db.sql:ro" \
    --env APP_ENV=demo --env "DATABASE_URL=postgresql://commercelab@db:5432/$scratch_db" \
    --env "SMOKE_SOURCE_DB=$scratch_db" api - <<'PY'
import os

from commercelab.data.db import connect
from scripts import seed

with connect(os.environ["DATABASE_URL"]) as conn, conn.transaction():
    if conn.execute("SELECT current_database()").fetchone() != (os.environ["SMOKE_SOURCE_DB"],):
        raise SystemExit("Refusing to seed outside the scratch database")
    seed.write(conn, *seed.generate(42))
PY

compose exec -T db pg_dump -U commercelab --format=custom --dbname="$scratch_db" \
    >"$work_dir/source.dump"
require_empty_target
compose exec -T db pg_restore -U commercelab --dbname=commercelab \
    --single-transaction --exit-on-error --no-owner --no-acl <"$work_dir/source.dump"

for database in "$scratch_db" commercelab; do
    sql "$database" -At >"$work_dir/$database.snapshot" <<'SQL'
SELECT (SELECT count(*) FROM products), (SELECT count(*) FROM orders),
       (SELECT count(*) FROM images);
SELECT status, count(*), sum(total) FROM orders GROUP BY status ORDER BY status COLLATE "C";
SELECT product_id, on_hand, reserved, available FROM product_availability ORDER BY product_id;
SELECT sha256, encode(sha256(data), 'hex') FROM images ORDER BY sha256 COLLATE "C";
SQL
done
cmp "$work_dir/$scratch_db.snapshot" "$work_dir/commercelab.snapshot"
printf 'Restored counts, order totals, stock and image hashes match the source.\n'

start_shop
grep -Fq 'Featured' "$work_dir/home.html" || fail "home page lacks the fixture collection"

product=$(sql commercelab -At -c "
    SELECT p.id, p.slug, p.sku, p.name, pi.image_sha256
    FROM products AS p
    JOIN product_availability AS pa ON pa.product_id = p.id
    JOIN product_images AS pi ON pi.product_id = p.id
    WHERE p.active AND pa.available >= 2
    ORDER BY p.id, pi.position LIMIT 1;
")
IFS='|' read -r product_id slug sku product_name media_key <<<"$product"
[[ "$product_id" =~ ^[0-9]+$ && "$media_key" =~ ^[a-f0-9]{64}$ ]] \
    || fail "fixture has no stocked product with media"
http_status 200 "$work_dir/product.html" "$web_url/p/$slug"
grep -Fq "$product_name" "$work_dir/product.html" || fail "product page lacks the fixture product name"
http_status 200 "$work_dir/media-before" "$web_url/media/$media_key"
digest=$(openssl dgst -sha256 -r "$work_dir/media-before")
[[ "${digest%% *}" == "$media_key" ]] || fail "media bytes do not match their SHA-256 key"

available_stock() {
    sql commercelab -At -c \
        "SELECT available FROM product_availability WHERE product_id = $product_id;"
}

quantity=2
cat >"$work_dir/checkout.json" <<JSON
{
  "contact": {"email": "compose-smoke@example.test", "name": "Smoke Test", "phone": "07700 900412"},
  "address": {"line1": "14 Albion Street", "city": "Leeds", "postcode": "LS1 6HX", "country": "GB"},
  "items": [{"product_id": $product_id, "quantity": $quantity}]
}
JSON
stock_before=$(available_stock)
http_status 201 "$work_dir/order-before.json" \
    --header 'Content-Type: application/json' --header "Idempotency-Key: $project" \
    --data-binary "@$work_dir/checkout.json" "$web_url/api/checkout"
stock_after=$(available_stock)
[[ "$stock_before" =~ ^[0-9]+$ && "$stock_after" =~ ^[0-9]+$ ]] || fail "missing stock readings"
[[ "$stock_after" -eq $((stock_before - quantity)) ]] || fail "checkout did not decrement stock by $quantity"
token=$(python3 - "$work_dir/order-before.json" "$product_id" "$quantity" <<'PY'
import json
import re
import sys

with open(sys.argv[1]) as response:
    order = json.load(response)
if order["status"] != "paid" or order["payment_status"] != "succeeded":
    raise SystemExit("Checkout did not return a paid order")
lines = [(item["product_id"], item["quantity"]) for item in order["items"]]
if lines != [(int(sys.argv[2]), int(sys.argv[3]))]:
    raise SystemExit("Checkout order lines do not match the request")
if not re.fullmatch(r"[a-f0-9]{32}", order["token"]):
    raise SystemExit("Checkout did not return an order token")
print(order["token"])
PY
)
printf 'Paid order %s for %s × %s. Stock changed from %s to %s.\n' \
    "$token" "$quantity" "$sku" "$stock_before" "$stock_after"

printf 'Service memory after checkout:\n'
db_container=$(compose ps --quiet db)
api_container=$(compose ps --quiet api)
web_container=$(compose ps --quiet web)
[[ -n "$db_container" && -n "$api_container" && -n "$web_container" ]] || fail "missing service containers"
docker_checked stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' \
    "$db_container" "$api_container" "$web_container"

compose down
start_shop
http_status 200 "$work_dir/order-after.json" "$api_url/orders/$token"
python3 - "$work_dir/order-before.json" "$work_dir/order-after.json" <<'PY'
import json
import sys

with open(sys.argv[1]) as before, open(sys.argv[2]) as after:
    if json.load(before) != json.load(after):
        raise SystemExit("Order response changed after container recreation")
PY
restored_stock=$(available_stock)
[[ "$restored_stock" == "$stock_after" ]] || fail "stock change did not persist"
http_status 200 "$work_dir/media-after" "$web_url/media/$media_key"
cmp "$work_dir/media-before" "$work_dir/media-after"
printf 'Order, stock decrement and identical media bytes survived container recreation.\n'

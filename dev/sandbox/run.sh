#!/usr/bin/env bash
# Start a stream's sandbox container, detached.
#
#   dev/sandbox/run.sh <stream> <memory> <cpus>
#   dev/sandbox/run.sh b-seed 1g 1          # backend stream
#   dev/sandbox/run.sh f-contracts 3g 2     # F0
#   dev/sandbox/run.sh storefront 4g 4      # the integration container
#
# Then run every command inside it:
#   docker exec cl-<stream> bash -lc "cd /work && uv sync && uv run pytest -q"
#
# Mounts:
#   worktree                      -> /work
#       storefront: the main checkout; otherwise
#       <main>/../commercelab-worktrees/sf/<stream>  (override with WORKTREE=/path)
#   <main>/.cache/images          -> /work/.cache/images  (the shared image download cache)
#   volume cl-<stream>-venv       -> /work/.venv                  (Linux binaries, not the Mac's)
#   volume cl-<stream>-node-modules -> /work/frontend/node_modules
#
# Limits: --memory and --memory-swap are equal (no swap), plus --cpus.
# If cl-<stream> already exists it is started (if stopped) and left as it is;
# remove it first (docker rm -f cl-<stream>) to change its limits or mounts.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <stream> <memory> <cpus>   e.g. $0 b-seed 1g 1" >&2
    exit 2
fi
stream=$1 memory=$2 cpus=$3
name="cl-${stream}"
image="commercelab-sandbox:latest"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The main checkout: the parent of the shared .git directory, from any worktree.
common_git_dir="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)"
main_checkout="$(dirname "$common_git_dir")"

if [[ -n "${WORKTREE:-}" ]]; then
    worktree="$(cd "$WORKTREE" && pwd)"
elif [[ "$stream" == "storefront" ]]; then
    worktree="$main_checkout"
else
    worktree="$(cd "$main_checkout/.." && pwd)/commercelab-worktrees/sf/${stream}"
fi
if [[ ! -d "$worktree" ]]; then
    echo "worktree not found: $worktree (create it with git worktree add, or set WORKTREE)" >&2
    exit 1
fi

if docker container inspect "$name" >/dev/null 2>&1; then
    if [[ "$(docker container inspect -f '{{.State.Running}}' "$name")" != "true" ]]; then
        docker start "$name" >/dev/null
    fi
    echo "$name already exists; started it if it was stopped (mounts $(docker container inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Source}}{{end}}{{end}}' "$name"))"
    exit 0
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
    docker build -t "$image" "$here"
fi

mkdir -p "$main_checkout/.cache/images"

docker run -d \
    --name "$name" \
    --hostname "$name" \
    --memory "$memory" --memory-swap "$memory" \
    --cpus "$cpus" \
    -v "$worktree:/work" \
    -v "$main_checkout/.cache/images:/work/.cache/images" \
    -v "${name}-venv:/work/.venv" \
    -v "${name}-node-modules:/work/frontend/node_modules" \
    "$image" >/dev/null

# Wait for the entrypoint to bring PostgreSQL up and create the role.
for _ in $(seq 1 60); do
    if docker exec "$name" psql -qtA -h localhost -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
        echo "$name running: $worktree -> /work, memory $memory, cpus $cpus"
        exit 0
    fi
    sleep 0.5
done
echo "$name started but PostgreSQL did not become ready; see: docker logs $name" >&2
exit 1

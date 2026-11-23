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
#   the repo's common git dir     -> the same absolute path, read-write, so git works
#                                    inside the container for linked worktrees too
#                                    (their .git file points at <main>/.git/worktrees/...)
#   volume cl-<stream>-venv       -> /work/.venv                  (Linux binaries, not the Mac's)
#   volume cl-<stream>-node-modules -> /work/frontend/node_modules
#       only for frontend streams (f-*) and storefront: the mount point creates
#       frontend/node_modules in the worktree, which backend streams must not get
#
# The image is labelled with a hash of dev/sandbox/*, and rebuilt whenever the
# label doesn't match, so a changed Dockerfile is never silently ignored.
#
# Limits: --memory and --memory-swap are equal (no swap), plus --cpus.
# If cl-<stream> already exists it is started (if stopped) and left as it is;
# remove it first (docker rm -f cl-<stream>) to change its limits, mounts or image.
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
    worktree="$(cd "$WORKTREE" && pwd -P)"
elif [[ "$stream" == "storefront" ]]; then
    worktree="$main_checkout"
else
    worktree="$(cd "$main_checkout/.." && pwd)/commercelab-worktrees/sf/${stream}"
fi
if [[ ! -d "$worktree" ]]; then
    echo "worktree not found: $worktree (create it with git worktree add, or set WORKTREE)" >&2
    exit 1
fi
# The worktree's own common git dir, absolute (for a linked worktree, the main
# checkout's .git). Mounted at the same path, so the worktree's .git file resolves.
worktree_git_dir="$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)"
worktree_git_dir="$(cd "$worktree_git_dir" && pwd -P)"

# Hash of everything in dev/sandbox (names and contents), for the image label.
if command -v sha256sum >/dev/null 2>&1; then sha=(sha256sum); else sha=(shasum -a 256); fi
sandbox_hash="$(
    cd "$here"
    for f in $(LC_ALL=C ls -1); do printf '%s\0' "$f"; cat "$f"; done | "${sha[@]}" | cut -d' ' -f1
)"
hash_label="commercelab.sandbox.hash"

if docker container inspect "$name" >/dev/null 2>&1; then
    if [[ "$(docker container inspect -f '{{.State.Running}}' "$name")" != "true" ]]; then
        docker start "$name" >/dev/null
    fi
    echo "$name already exists; started it if it was stopped (mounts $(docker container inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Source}}{{end}}{{end}}' "$name"))"
    container_hash="$(docker image inspect -f "{{index .Config.Labels \"$hash_label\"}}" \
        "$(docker container inspect -f '{{.Image}}' "$name")" 2>/dev/null || true)"
    if [[ "$container_hash" != "$sandbox_hash" ]]; then
        echo "warning: $name runs an image built from an older dev/sandbox;" \
            "recreate it with: docker rm -f $name && $0 $stream $memory $cpus" >&2
    fi
    exit 0
fi

image_hash="$(docker image inspect -f "{{index .Config.Labels \"$hash_label\"}}" "$image" 2>/dev/null || true)"
if [[ "$image_hash" != "$sandbox_hash" ]]; then
    docker build --label "$hash_label=$sandbox_hash" -t "$image" "$here"
fi

mkdir -p "$main_checkout/.cache/images"

mounts=(
    -v "$worktree:/work"
    -v "$worktree_git_dir:$worktree_git_dir"
    -v "$main_checkout/.cache/images:/work/.cache/images"
    -v "${name}-venv:/work/.venv"
)
if [[ "$stream" == f-* || "$stream" == "storefront" ]]; then
    mounts+=(-v "${name}-node-modules:/work/frontend/node_modules")
fi

docker run -d \
    --name "$name" \
    --hostname "$name" \
    --memory "$memory" --memory-swap "$memory" \
    --cpus "$cpus" \
    "${mounts[@]}" \
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

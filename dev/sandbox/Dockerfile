# CommerceLab stream sandbox: one container per stream, started by run.sh.
#
# Contains everything a stream runs: PostgreSQL 17 (PGDG), uv with Python 3.14,
# Node 22 and Playwright's Chromium. The worktree itself is bind-mounted at
# /work; nothing from the repo is baked into the image.
#
# Build:  docker build -t commercelab-sandbox dev/sandbox   (run.sh does this if needed)

FROM ghcr.io/astral-sh/uv:0.13.9 AS uv

FROM ubuntu:24.04

ARG NODE_VERSION=22.23.5
ARG PLAYWRIGHT_VERSION=1.65.1
ARG PG_MAJOR=17

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    # uv: interpreters live in the image; the venv lives on a per-stream volume.
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_LINK_MODE=copy \
    # One shared, image-level browser directory, so the frontend's
    # @playwright/test finds Chromium without downloading it again.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # libpq defaults: `postgresql://localhost/<db>` connects as the trust-auth
    # role created by the entrypoint, so the repo's default URLs work unchanged.
    PGUSER=commercelab \
    PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:$PATH

COPY --from=uv /uv /uvx /usr/local/bin/

# PostgreSQL 17 from PGDG, Node 22 from the official tarball, Python 3.14 via uv,
# Playwright Chromium with its system dependencies. One layer, apt lists and
# download caches removed, to keep the image small.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg git xz-utils tini; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-${PG_MAJOR}; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported arch $arch"; exit 1 ;; esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
        | tar -xJ -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE --exclude='share/doc'; \
    node --version; npm --version; \
    uv python install 3.14; \
    npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium; \
    rm -rf /root/.npm /root/.cache /tmp/* /var/lib/apt/lists/*

# Trust auth for local connections only (socket and loopback). This is a
# per-stream throwaway database inside the container, never exposed.
RUN set -eux; \
    hba=/etc/postgresql/${PG_MAJOR}/main/pg_hba.conf; \
    printf '%s\n' \
        'local   all  all                 trust' \
        'host    all  all  127.0.0.1/32   trust' \
        'host    all  all  ::1/128        trust' > "$hba"; \
    echo "listen_addresses = 'localhost'" >> /etc/postgresql/${PG_MAJOR}/main/postgresql.conf

COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint
RUN chmod +x /usr/local/bin/sandbox-entrypoint

WORKDIR /work
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-entrypoint"]
CMD ["sleep", "infinity"]

FROM ghcr.io/astral-sh/uv:0.9.30 AS uv

FROM python:3.14.3-slim-bookworm AS dependencies
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-managed-python

FROM python:3.14.3-slim-bookworm
WORKDIR /app
ENV PATH="/app/.venv/bin:${PATH}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=dependencies /app/.venv .venv
COPY commercelab/ commercelab/
COPY scripts/__init__.py scripts/check_shop_schema.py scripts/
USER 10001:10001

#!/usr/bin/env bash
# Starts this container's own PostgreSQL 17 and makes sure the `commercelab`
# role exists (trust auth on localhost), then runs the command (default: sleep).
set -euo pipefail

pg_ctlcluster 17 main start

for _ in $(seq 1 50); do
    pg_isready -q -h localhost -U postgres && break
    sleep 0.2
done
pg_isready -h localhost -U postgres

# Superuser so tests can CREATE DATABASE and the scripts can rebuild schemas.
psql -q -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commercelab') THEN
        CREATE ROLE commercelab LOGIN SUPERUSER;
    END IF;
END
$$;
SQL

exec "$@"

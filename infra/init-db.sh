#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$RUNTIME_DB_PASSWORD" <<'SQL'
CREATE ROLE superapp_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'runtime_password';
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
SQL

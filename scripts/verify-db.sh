#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres database and runs the RLS
# test suite. Used in CI so a broken policy fails the build, not production.
#
#   PGHOST=/tmp PGPORT=5433 ./scripts/verify-db.sh
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-pf_verify}"
PSQL="psql -h $PGHOST -p $PGPORT -U $PGUSER -v ON_ERROR_STOP=1 -q"

$PSQL -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

# Local stand-ins for the auth/storage schemas Supabase provides.
$PSQL -d "$DB" -f supabase/tests/00_supabase_stubs.sql
echo "  stubs applied"

for migration in supabase/migrations/*.sql; do
  # pgvector is only required from Phase 3; skip it when unavailable locally.
  if [ "${SKIP_VECTOR:-1}" = "1" ]; then
    sed 's/^create extension if not exists "vector";/select 1;/' "$migration" | $PSQL -d "$DB" -f -
  else
    $PSQL -d "$DB" -f "$migration"
  fi
  echo "  $(basename "$migration")"
done

STUBS="supabase/tests/00_supabase_stubs.sql"
for test in supabase/tests/[0-9][0-9]_*.sql; do
  [ -e "$test" ] || continue
  # The stub file is applied above, before the migrations.
  [ "$test" = "$STUBS" ] && continue
  $PSQL -d "$DB" -f "$test"
  echo "  $(basename "$test")"
done

echo "database verification passed"

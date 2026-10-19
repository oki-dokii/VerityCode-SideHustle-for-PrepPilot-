#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/Library/PostgreSQL/18/bin}"
DATA="$PWD/.local/postgres"
mkdir -p "$PWD/.local"
if [ ! -f "$DATA/PG_VERSION" ]; then
  "$PG_BIN/initdb" -D "$DATA" -U veritycode --auth=trust --encoding=UTF8 --no-locale >/dev/null
fi
if ! "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DATA" -l "$PWD/.local/postgres.log" -o "-h 127.0.0.1 -p 54329 -k $PWD/.local" start
fi
if ! "$PG_BIN/psql" -h 127.0.0.1 -p 54329 -U veritycode -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='veritycode'" | grep -q 1; then
  "$PG_BIN/createdb" -h 127.0.0.1 -p 54329 -U veritycode veritycode
fi
printf 'Local development database ready on 127.0.0.1:54329 (trust auth; loopback only).\n'

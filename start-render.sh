#!/usr/bin/env bash
set -euo pipefail

cd /app
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
api_pid=$!

cd /app/web
node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-10000}" &
web_pid=$!

cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

wait -n "$api_pid" "$web_pid"

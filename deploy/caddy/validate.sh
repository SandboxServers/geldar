#!/usr/bin/env bash
# Validates the deploy/caddy site files with the pinned official Caddy image.
# Each set is checked as one Caddyfile, so the live files and the kill-switch files both pass.
# Needs docker. It runs `docker run --rm` of the image and touches no other container.
# Usage, from the repo root: bash deploy/caddy/validate.sh
set -euo pipefail

# caddy 2.10.2, published 2025-08-23 (at least two weeks old when pinned).
IMAGE="caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Placeholder values for validation only. The real domain and upstreams come from C2-07.
env_args=(
  -e GELDAR_DOMAIN=example.test
  -e GELDAR_MAP_UPSTREAM=map.example.test:8100
  -e GELDAR_MAP_NF_UPSTREAM=map-nf.example.test:8110
  -e GELDAR_GLASS_UPSTREAM=glass.example.test:8080
  -e GELDAR_MCP_UPSTREAM=mcp.example.test:8788
  -e GELDAR_NF_MCP_UPSTREAM=127.0.0.1:46788
  -e GELDAR_REGISTER_UPSTREAM=register.example.test:18090
  -e GELDAR_KINO_ENABLED=1
  -e GELDAR_INGEST_HOST=ingest.example.test
  -e GELDAR_INGEST_UPSTREAM=localhost:4320
  -e GELDAR_INGEST_TOKEN=0000000000000000000000000000000000000000000000000000000000000000
)

check() {
  local set_name="$1"
  shift
  local cfg="$work/$set_name"
  mkdir -p "$cfg"
  : > "$cfg/Caddyfile"
  for f in "$@"; do
    cp "$here/$f" "$cfg/$f"
    printf 'import %s\n' "$f" >> "$cfg/Caddyfile"
  done
  docker run --rm "${env_args[@]}" -v "$cfg:/etc/caddy:ro" "$IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
}

check live map.caddy glass.caddy mcp.caddy
check killed map-off.caddy glass-off.caddy mcp-off.caddy
# The ingest site and its kill switch name the same host, so they are never in one set. Test values only, never the real token.
check live-otel map.caddy glass.caddy mcp.caddy otel.caddy
check killed-otel map-off.caddy glass-off.caddy mcp-off.caddy otel-off.caddy
# The NeoForge map is a separate host (map.neoforge.<domain>), so its live and kill-switch files may share a set with the others.
check live-nf map.caddy glass.caddy mcp.caddy map-neoforge.caddy nf-mcp.caddy
check killed-nf map-off.caddy glass-off.caddy mcp-off.caddy map-neoforge-off.caddy nf-mcp-off.caddy

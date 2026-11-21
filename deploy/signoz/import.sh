#!/usr/bin/env bash
# G1: import deploy/signoz/*-dashboard.json and deploy/signoz/*-alerts-*.json into SigNoz v0.148.1 through the SSH tunnel
# to the loopback API port. Idempotent: an existing dashboard (matched by title) or rule (matched by alert name) is
# updated, never duplicated. Runbook: docs/runbooks/signoz-import.md.
# UNVERIFIED: the dashboard and rule routes and their list shapes below come from SigNoz source knowledge, not from this
# repo (the repo verifies only the login and TTL routes). Check them on the first run; the runbook says how.
# Usage: import.sh --token-file PATH [--url http://127.0.0.1:PORT] [--dry-run]
#   --token-file PATH  file whose first line is the admin API token. Read into a header file in a temp dir; never
#                      printed, never in argv. The file must live outside the repo checkout.
#   --url              the loopback end of the SSH tunnel (default http://127.0.0.1:8095). Anything else is refused.
#   --dry-run          print what would be sent. Sends nothing and reads no token.
# Needs bash, jq and (for a real run) curl. Writes only under a temp dir that it removes on exit.
set -euo pipefail
umask 077
# No proxy for the tunnel: a proxy in the environment would send the admin token to someone else's host.
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
URL="http://127.0.0.1:8095"
TOKEN_FILE=""
DRY_RUN=0

die() {
  echo "import.sh: $*" >&2
  exit 1
}

usage() {
  echo "usage: import.sh --token-file PATH [--url http://127.0.0.1:PORT] [--dry-run]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --token-file)
      [ $# -ge 2 ] || usage
      TOKEN_FILE="$2"
      shift 2
      ;;
    --url)
      [ $# -ge 2 ] || usage
      URL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *) usage ;;
  esac
done

if ! [[ "$URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then
  die "--url must be http://127.0.0.1:PORT, the loopback end of the SSH tunnel"
fi
command -v jq >/dev/null || die "jq is required"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$DRY_RUN" -eq 0 ]; then
  command -v curl >/dev/null || die "curl is required"
  [ -n "$TOKEN_FILE" ] && [ -r "$TOKEN_FILE" ] || die "--token-file PATH is required and must be readable"
  # pwd -P resolves symlinks, so a token file reached through a link into the checkout is still refused.
  token_dir="$(cd "$(dirname "$TOKEN_FILE")" && pwd -P)"
  case "$token_dir/" in
    "$REPO_ROOT"/*) die "the token file must live outside the repo checkout" ;;
  esac
  TOKEN=""
  IFS= read -r TOKEN < "$TOKEN_FILE" || true
  TOKEN="${TOKEN%$'\r'}"
  [ -n "$TOKEN" ] || die "the token file's first line is empty"
  printf 'Authorization: Bearer %s\n' "$TOKEN" > "$TMP/auth.hdr"
  TOKEN=""
fi

# api METHOD PATH [BODY_FILE]: the only call that sends anything. The token goes through the header file, not argv.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -f --noproxy '*' -X "$method" -H "@$TMP/auth.hdr" -H 'Accept: application/json' \
      -H 'Content-Type: application/json' --data-binary "@$body" "$URL$path"
  else
    curl -sS -f --noproxy '*' -X "$method" -H "@$TMP/auth.hdr" -H 'Accept: application/json' "$URL$path"
  fi
}

# send_dashboard FILE: PUT the dashboard whose title matches, else POST it.
send_dashboard() {
  local file="$1" title id
  title="$(jq -r '.title' "$file")"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry-run: dashboard \"$title\" ($(basename "$file")): PUT /api/v1/dashboards/<id> if a dashboard has this title, else POST /api/v1/dashboards"
    return
  fi
  api GET /api/v1/dashboards > "$TMP/dashboards.json"
  id="$(jq -r --arg t "$title" '[(.data // [])[] | select(.data.title == $t) | .id] | if length > 1 then error("more than one dashboard titled " + $t) else (.[0] // "") end' "$TMP/dashboards.json")"
  if [ -n "$id" ]; then
    api PUT "/api/v1/dashboards/$id" "$file" > /dev/null
    echo "updated dashboard \"$title\""
  else
    api POST /api/v1/dashboards "$file" > /dev/null
    echo "created dashboard \"$title\""
  fi
}

# send_rules FILE: for each rule in the file's rules array, PUT the rule with the same alert name, else POST it.
send_rules() {
  local file="$1" count i title id
  count="$(jq '.rules | length' "$file")"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry-run: $count rule(s) from $(basename "$file"): PUT /api/v1/rules/<id> if a rule has the same alert name, else POST /api/v1/rules"
    return
  fi
  api GET /api/v1/rules > "$TMP/rules.json"
  for ((i = 0; i < count; i++)); do
    title="$(jq -r ".rules[$i].alert" "$file")"
    jq -c ".rules[$i]" "$file" > "$TMP/rule.json"
    id="$(jq -r --arg t "$title" '(.data | if type == "array" then . else (.rules // []) end) as $rules | [$rules[] | select(.alert == $t) | .id] | if length > 1 then error("more than one rule named " + $t) else (.[0] // "") end' "$TMP/rules.json")"
    if [ -n "$id" ]; then
      api PUT "/api/v1/rules/$id" "$TMP/rule.json" > /dev/null
      echo "updated rule \"$title\""
    else
      api POST /api/v1/rules "$TMP/rule.json" > /dev/null
      echo "created rule \"$title\""
    fi
  done
}

DASHBOARDS=()
ALERTS=()
for f in "$SCRIPT_DIR"/*-dashboard.json; do
  if [ -e "$f" ]; then DASHBOARDS+=("$f"); fi
done
for f in "$SCRIPT_DIR"/*-alerts-*.json; do
  if [ -e "$f" ]; then ALERTS+=("$f"); fi
done
[ "${#DASHBOARDS[@]}" -gt 0 ] || die "no *-dashboard.json files next to this script"

# Validate every file before the first request, so a bad file sends nothing.
for f in "${DASHBOARDS[@]}"; do
  jq -e '(.title | type == "string") and (.title != "")' "$f" > /dev/null || die "$(basename "$f"): not a dashboard with a title"
done
for f in "${ALERTS[@]}"; do
  jq -e '(.rules | type == "array") and all(.rules[]; (.alert | type == "string") and (.alert != ""))' "$f" > /dev/null \
    || die "$(basename "$f"): not an alert file (rules[] with alert names)"
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run against $URL: nothing will be sent"
fi
for f in "${DASHBOARDS[@]}"; do
  send_dashboard "$f"
done
for f in "${ALERTS[@]}"; do
  send_rules "$f"
done
echo "done: ${#DASHBOARDS[@]} dashboard file(s), ${#ALERTS[@]} alert file(s)"

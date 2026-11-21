#!/usr/bin/env bash
# G1: import deploy/signoz/*-dashboard.json and deploy/signoz/*-alerts-*.json into SigNoz v0.148.1 through the SSH tunnel
# to the loopback API port. Idempotent: a dashboard whose title is already listed is skipped (or, with --replace,
# deleted and created again); a rule whose alert name is already listed is updated, never duplicated.
# Runbook: docs/runbooks/signoz-import.md.
# Routes, from SigNoz v0.148.1 source: dashboards are v2 (GET and POST /api/v2/dashboards, DELETE /api/v2/dashboards/{id});
# the list is {status, data: {dashboards: [{id, spec: {display: {name}}}], total}}, paged (limit at most 200).
# Rules are v1 (GET and POST /api/v1/rules, PUT /api/v1/rules/{id}); the list is {status, data: {rules: [{id, alert}]}}.
# UNVERIFIED on a live node: that POST /api/v1/rules accepts the rule bodies in the alert files, that the v1 dashboard
# bodies convert to v2 as intended, and the notification channel. The runbook says how to check them.
# Usage: import.sh --token-file PATH [--url http://127.0.0.1:PORT] [--dry-run] [--replace] [--dashboards-only]
#   --token-file PATH  file whose first line is the admin API token. Read into a header file in a temp dir; never
#                      printed, never in argv. The file must live outside the repo checkout.
#   --url              the loopback end of the SSH tunnel (default http://127.0.0.1:8095). Anything else is refused.
#   --dry-run          print what would be sent. Sends nothing and reads no token.
#   --replace          a dashboard whose title is already listed is deleted by id and created again. Default: skip it.
#   --dashboards-only  import only the *-dashboard.json files. Makes no call to /api/v1/rules and reads no channel; the
#                      rules list is not read. Alert rules are a later run without this flag (the channel comes first).
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
REPLACE=0
DASHBOARDS_ONLY=0

die() {
  echo "import.sh: $*" >&2
  exit 1
}

usage() {
  echo "usage: import.sh --token-file PATH [--url http://127.0.0.1:PORT] [--dry-run] [--replace] [--dashboards-only]" >&2
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
    --replace)
      REPLACE=1
      shift
      ;;
    --dashboards-only)
      DASHBOARDS_ONLY=1
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

# list_dashboards: GET every page of the v2 dashboard list into $TMP/dashboards.jsonl, one dashboard per line.
list_dashboards() {
  local offset=0 n total
  : > "$TMP/dashboards.jsonl"
  while :; do
    api GET "/api/v2/dashboards?limit=200&offset=$offset" > "$TMP/page.json"
    jq -e '(((.data // {}).dashboards // []) | type) == "array"' "$TMP/page.json" > /dev/null \
      || die "the dashboard list is not the v2 shape (data.dashboards[]); nothing was sent"
    n="$(jq '((.data // {}).dashboards // []) | length' "$TMP/page.json")"
    jq -c '((.data // {}).dashboards // [])[]' "$TMP/page.json" >> "$TMP/dashboards.jsonl"
    total="$(jq '(.data // {}).total // 0' "$TMP/page.json")"
    offset=$((offset + n))
    if [ "$n" -eq 0 ] || [ "$offset" -ge "$total" ]; then break; fi
  done
}

# list_rules: GET the v1 rule list into $TMP/rules.json.
list_rules() {
  api GET /api/v1/rules > "$TMP/rules.json"
  jq -e '(((.data // {}) | type) == "object") and ((((.data // {}).rules) // []) | type == "array")' "$TMP/rules.json" \
    > /dev/null || die "the rule list is not the v1 shape (data.rules[]); nothing was sent"
}

# dashboard_ids TITLE: the ids of the listed dashboards whose display name is TITLE, one per line.
dashboard_ids() {
  jq -r --arg t "$1" 'select(.spec.display.name == $t) | .id' "$TMP/dashboards.jsonl"
}

# rule_ids ALERT: the ids of the listed rules whose alert name is ALERT, one per line.
rule_ids() {
  jq -r --arg t "$1" '((.data // {}).rules // [])[] | select(.alert == $t) | .id' "$TMP/rules.json"
}

# send_dashboard FILE: a title already listed is skipped (with --replace: deleted by id, then created); else POST.
send_dashboard() {
  local file="$1" title
  local -a ids=()
  title="$(jq -r '.title' "$file")"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry-run: dashboard \"$title\" ($(basename "$file")): POST /api/v2/dashboards unless a dashboard has this title (then skip; with --replace: DELETE /api/v2/dashboards/<id>, then POST)"
    return
  fi
  mapfile -t ids < <(dashboard_ids "$title")
  if [ "${#ids[@]}" -eq 0 ]; then
    api POST /api/v2/dashboards "$file" > /dev/null
    echo "created dashboard \"$title\""
  elif [ "$REPLACE" -eq 0 ]; then
    echo "skipped dashboard \"$title\": already exists (id ${ids[0]}); run with --replace to delete it and create it again"
  else
    [[ "${ids[0]}" =~ ^[0-9a-fA-F-]+$ ]] || die "the id of \"$title\" is not a UUID"
    api DELETE "/api/v2/dashboards/${ids[0]}" > /dev/null
    api POST /api/v2/dashboards "$file" > /dev/null
    echo "replaced dashboard \"$title\""
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
  for ((i = 0; i < count; i++)); do
    title="$(jq -r ".rules[$i].alert" "$file")"
    jq -c ".rules[$i]" "$file" > "$TMP/rule.json"
    id="$(rule_ids "$title")"
    if [ -n "$id" ]; then
      [[ "$id" =~ ^[0-9a-zA-Z-]+$ ]] || die "the id of rule \"$title\" is not safe in a path"
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
if [ "$DASHBOARDS_ONLY" -eq 1 ]; then
  # Alert files are not read or sent: no rules list, no rules call, no channel check.
  echo "alert rules skipped (--dashboards-only): ${#ALERTS[@]} alert file(s) not imported; run without --dashboards-only once the channel exists"
  ALERTS=()
fi

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
else
  # Read both lists and check every name before the first write: a list of another shape, or a name that matches
  # more than one listed item, stops the run before anything is sent.
  list_dashboards
  if [ "$DASHBOARDS_ONLY" -eq 0 ]; then
    list_rules
  fi
  for f in "${DASHBOARDS[@]}"; do
    title="$(jq -r '.title' "$f")"
    mapfile -t matches < <(dashboard_ids "$title")
    [ "${#matches[@]}" -le 1 ] || die "more than one dashboard titled \"$title\""
  done
  for f in "${ALERTS[@]}"; do
    for ((i = 0; i < $(jq '.rules | length' "$f"); i++)); do
      title="$(jq -r ".rules[$i].alert" "$f")"
      mapfile -t matches < <(rule_ids "$title")
      [ "${#matches[@]}" -le 1 ] || die "more than one rule named \"$title\""
    done
  done
fi
for f in "${DASHBOARDS[@]}"; do
  send_dashboard "$f"
done
for f in "${ALERTS[@]}"; do
  send_rules "$f"
done
echo "done: ${#DASHBOARDS[@]} dashboard file(s), ${#ALERTS[@]} alert file(s)"

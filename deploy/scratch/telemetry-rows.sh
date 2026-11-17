#!/bin/sh
# Row driver for the scratch-telemetry test plan (docs/analysis/telemetry/paper-plugin/scratch-test-plan.md section 3,
# docs/runbooks/scratch-telemetry.md "Row driver"). Copy this file and telemetry-verify.sh into one directory on the node,
# then run once against a running stack: nohup sh telemetry-rows.sh >rows.out 2>&1 &
# Usage: sh telemetry-rows.sh [--list | --print-compose-files | --only T1,T3,...]
# Needs: SCRATCH_TELEMETRY_OUT (absolute, the sink directory), SCRATCH_NATS_AUTH_DIR (only for R1/N1/N2/the final restore),
# docker, POSIX sh, awk, sed, grep, sort, sha256sum. Optional: SCRATCH_REPO_ROOT (compose files for R1/N1/N2),
# SCRATCH_ROWS_PROFILE (host path of ledger.properties), SCRATCH_ROWS_CGROUP_DIR, SCRATCH_ROWS_MEMINFO (test hooks).
# Stdout: one line per row, "ROW <id> PASS|FAIL|SKIP got=<v> want=<w>", ABORT lines and the SUMMARY block. Detail goes to
# the log $SCRATCH_TELEMETRY_OUT/telemetry-rows-<utc>.log. Exit: 0 no row failed, 1 a row failed, 2 usage or environment,
# 3 ABORT, 4 the profile was not restored byte for byte.
# The script never stops, kills or removes a container. It pauses paper (T3) and otel-sink (Q1) and unpauses them again,
# recreates paper with `compose up` for R1/N1/N2 (compose replaces the container itself), rewrites the one mounted profile
# in place (cat > file keeps the inode; never sed -i) and writes the log.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
VERIFY=$HERE/telemetry-verify.sh
PROJECT=scratch-telemetry
ROOT=${SCRATCH_REPO_ROOT:-$(cd "$HERE/../.." 2>/dev/null && pwd)}
STATE=${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/geldar-scratch/$PROJECT
NATS_OV=$STATE/nats-override.yml
MEM_MAX=15032385536 # 14 GiB
AVAIL_MIN_KB=31457280 # 30 GiB
ALL_ROWS="T1 T3 T4 T5 T6 S1 V6 G1 X4 X6 D1 K1 R1 N1 N2 C1 Q1"
# Dependencies (pseudo entries: @census = census collector exports geldar_event_count_total, @compose = the compose files
# exist, @stack = the stack is back in its default state). A row whose dependency failed or did not run is skipped.
deps_of() {
  case $1 in
    T5) echo "T4" ;; # T5 sets tick rate 20 and needs T4's proof that rcon tick rate works
    G1 | K1) echo "@census" ;;
    R1 | N1) echo "@compose @stack" ;;
    N2) echo "N1" ;;
    C1 | Q1) echo "@stack" ;;
  esac
}
# The -f list is DUPLICATED from compose_run in deploy/scratch/scratch.sh (phase0, nats-auth only with the override, scratch,
# scratch-telemetry, the NATS override last). scratch.sh has no print mode; --print-compose-files prints this list and
# tools/repo-checks/src/scratch-rows.test.ts compares it with the call scratch.sh makes.
compose_run() {
  [ -f "$NATS_OV" ] && set -- -f "$NATS_OV" "$@"
  [ -n "${EXTRA_F:-}" ] && set -- -f "$EXTRA_F" "$@"
  set -- -f "$ROOT/compose/opt-in/scratch-telemetry.yml" "$@"
  set -- -f "$ROOT/compose/opt-in/scratch.yml" "$@"
  [ -f "$NATS_OV" ] && set -- -f "$ROOT/compose/nats-auth.yml" "$@"
  set -- -p "$PROJECT" -f "$ROOT/compose/phase0.yml" "$@"
  if [ -n "${PRINT_ONLY:-}" ]; then printf '%s\n' "$@"; else docker compose "$@"; fi
}

ONLY=''
case "${1:-}" in
  --list)
    for r in $ALL_ROWS; do echo "$r deps=$(deps_of "$r" | tr ' ' ',')"; done
    exit 0
    ;;
  --print-compose-files)
    PRINT_ONLY=1 compose_run config
    exit 0
    ;;
  --only) ONLY=${2:-} ;;
  '') ;;
  *)
    echo "usage: sh telemetry-rows.sh [--list | --print-compose-files | --only T1,T3,...]" >&2
    exit 2
    ;;
esac
if [ -n "$ONLY" ]; then
  for r in $(echo "$ONLY" | tr ',' ' '); do
    case " $ALL_ROWS " in *" $r "*) ;; *) echo "unknown row: $r" >&2; exit 2 ;; esac
  done
fi

OUT=${SCRATCH_TELEMETRY_OUT:-}
case "$OUT" in /* | [A-Za-z]:/*) [ -d "$OUT" ] || OUT='' ;; *) OUT='' ;; esac
[ -n "$OUT" ] || { echo "SCRATCH_TELEMETRY_OUT must be an existing absolute directory" >&2; exit 2; }
[ -f "$VERIFY" ] || { echo "telemetry-verify.sh must sit next to this script" >&2; exit 2; }
export SCRATCH_TELEMETRY_OUT="$OUT"
LOG=$OUT/telemetry-rows-$(date -u +%Y%m%dT%H%M%SZ).log
: >"$LOG"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >>"$LOG"; }

# Containers of the stack, found through the compose project label (never by a fixed name).
by_service() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' 2>>"$LOG" | head -n 1
}
PAPER=$(by_service paper)
SINK=$(by_service otel-sink)
[ -n "$PAPER" ] || { echo "no running paper container with the label com.docker.compose.project=$PROJECT" >&2; exit 2; }

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
PROFILE=${SCRATCH_ROWS_PROFILE:-}
if [ -z "$PROFILE" ]; then
  PROFILE=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/plugins/Ledger/ledger.properties"}}{{.Source}}{{end}}{{end}}' "$PAPER" 2>>"$LOG")
fi
[ -f "${PROFILE:-}" ] || PROFILE=$HERE/ledger.properties
[ -f "$PROFILE" ] || { echo "ledger.properties not found (set SCRATCH_ROWS_PROFILE)" >&2; exit 2; }
ORIG=$OUT/ledger.properties.orig.$$
cat "$PROFILE" >"$ORIG"
START_SHA=$(sha_of "$PROFILE")
START_INODE=$(ls -i "$PROFILE" | awk '{print $1}')
T_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "paper=$PAPER sink=$SINK profile_sha256=$START_SHA inode=$START_INODE"

# Non-scratch containers: name and StartedAt at start, compared at every row boundary.
non_scratch() {
  docker ps --format '{{.Names}} {{.Label "geldar.scratch"}}' 2>>"$LOG" | awk '$2 != "true" { print $1 }' | while read -r n; do
    echo "$n $(docker inspect -f '{{.State.StartedAt}}' "$n" 2>>"$LOG")"
  done
}
log "docker ps at start: $(docker ps --format '{{.Names}} {{.Status}}' 2>>"$LOG" | tr '\n' ';')"
NS_START=$(non_scratch)
log "non-scratch at start: $(echo "$NS_START" | tr '\n' ';')"

# Paper's cgroup (v2): the explicit hook, or the systemd or cgroupfs docker path of the container id.
CG=${SCRATCH_ROWS_CGROUP_DIR:-}
if [ -z "$CG" ]; then
  cid=$(docker inspect -f '{{.Id}}' "$PAPER" 2>>"$LOG")
  for c in "/sys/fs/cgroup/system.slice/docker-$cid.scope" "/sys/fs/cgroup/docker/$cid"; do
    [ -f "$c/memory.current" ] && CG=$c && break
  done
fi
MEMINFO=${SCRATCH_ROWS_MEMINFO:-/proc/meminfo}
mem_now() { cat "$CG/memory.current" 2>/dev/null || echo 0; }

abort() {
  log "ABORT $1"
  echo "ABORT reason=$1"
  exit 3
}
guard() {
  m=$(mem_now)
  awk -v m="$m" -v max="$MEM_MAX" 'BEGIN { exit !(m + 0 > max + 0) }' && abort "paper-memory-current-above-14GiB:$m"
  a=$(awk '/^MemAvailable:/ { print $2 }' "$MEMINFO" 2>/dev/null)
  [ -n "$a" ] && [ "$a" -lt "$AVAIL_MIN_KB" ] && abort "node-MemAvailable-below-30GiB:${a}kB"
  now=$(non_scratch)
  [ "$now" = "$NS_START" ] || abort "non-scratch-container-restarted-or-gone"
}
# Plain sleep in chunks of at most 60 s, with the guard between chunks.
nap() {
  left=$1
  while [ "$left" -gt 0 ]; do
    s=$left
    [ "$s" -gt 60 ] && s=60
    sleep "$s"
    left=$((left - s))
    guard
  done
}

# Readers on top of telemetry-verify.sh. SINCE is the sink line count noted before an action.
SINCE=0
lines_now() { cat "$OUT"/*.jsonl 2>/dev/null | wc -l | tr -d ' '; }
vf() { SCRATCH_TELEMETRY_SINCE_LINE=$SINCE sh "$VERIFY" "$@" 2>>"$LOG"; }
lastv() { vf metric "$@" | sed -n 's/^last=//p'; }
maxv() { vf max "$@" | sed -n 's/^max=//p'; }
ok() { awk "BEGIN { exit !($1) }"; }
isnum() { case "$1" in '' | none | *[!0-9.eE+-]*) return 1 ;; esac; }
rc() { docker exec "$PAPER" rcon-cli "$1" 2>>"$LOG"; }
sink_lines() { cat "$OUT"/*.jsonl 2>/dev/null | tail -n +$((SINCE + 1)); }
attr_values() { # numeric attribute values in file order
  grep -o -E "\"key\":\"$1\",\"value\":\{\"[A-Za-z]+\":\"?-?[0-9.]+" | sed 's/.*:"\{0,1\}//'
}
tick_p95() { rc 'tick query' | sed -n 's/.*P95: *\([0-9.]*\).*/\1/p' | head -n 1; }

# --- rows. Each sets GOT and WANT and returns 0 (pass), 1 (fail) or 2 (skip, SKIP_REASON set). ---
row_T1() {
  WANT="delta/elapsed 20/s +-5%"
  SINCE=$(lines_now)
  nap 80
  hc=$(vf histcount geldar_tick_lag_ms)
  d=$(echo "$hc" | sed -n 's/.*delta=//p')
  ex=$(sink_lines | grep -F '"geldar_tick_lag_ms"')
  ts() { printf '%s' "$1" | sed 's/^.*"geldar_tick_lag_ms"//' | grep -o -E '"timeUnixNano":"?[0-9]+' | head -n 1 | sed 's/.*:"\{0,1\}//'; }
  t0=$(ts "$(echo "$ex" | head -n 1)")
  t1=$(ts "$(echo "$ex" | tail -n 1)")
  isnum "$d" && isnum "$t0" && isnum "$t1" || { GOT="no-histogram-or-timestamps"; return 1; }
  e=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.1f", (b - a) / 1e9 }')
  GOT="delta=$d elapsed=${e}s"
  ok "$e >= 30" || return 1
  r=$(awk -v d="$d" -v e="$e" 'BEGIN { printf "%.2f", d / e }')
  GOT="$GOT rate=$r/s"
  ok "$r >= 19 && $r <= 21"
}
row_T3() {
  WANT="stalls +1; flag=1 2000-2500ms; flag=0 4000ms +-10%"
  s0=$(lastv geldar_tick_stalls_total)
  isnum "$s0" || s0=0
  SINCE=$(lines_now)
  docker pause "$PAPER" >>"$LOG" 2>&1 || { GOT="pause-failed"; return 1; }
  PAUSED=1
  sleep 4
  docker unpause "$PAPER" >>"$LOG" 2>&1
  PAUSED=0
  nap 45
  s1=$(lastv geldar_tick_stalls_total)
  isnum "$s1" || s1=0
  recs=$(sink_lines | grep -F 'geldar.server.stall')
  flags=$(echo "$recs" | attr_values geldar.flag | tr '\n' ' ')
  durs=$(echo "$recs" | attr_values geldar.duration_ms | tr '\n' ' ')
  GOT="stalls=$s0->$s1 flags=${flags% } durations=${durs% }"
  [ "${flags% }" = "1 0" ] || return 1
  set -- $durs
  ok "$s1 - $s0 == 1 && $1 >= 2000 && $1 <= 2500 && $2 >= 3600 && $2 <= 4400"
}
row_T4() {
  WANT="1m near 10 at rate 10; 19-20.05 at rate 20"
  rc 'tick rate 10' >>"$LOG"
  SINCE=$(lines_now)
  nap 180
  a=$(lastv geldar_tps@window=1m)
  rc 'tick rate 20' >>"$LOG"
  SINCE=$(lines_now)
  nap 180
  b=$(lastv geldar_tps@window=1m)
  GOT="rate10=$a rate20=$b"
  isnum "$a" && isnum "$b" && ok "$a >= 9 && $a <= 11 && $b >= 19 && $b <= 20.05"
}
row_T5() {
  WANT="frozen max 1 then 0; target 10 then 20"
  rc 'tick rate 20' >>"$LOG"
  nap 20
  SINCE=$(lines_now)
  rc 'tick freeze' >>"$LOG"
  FROZEN=1
  nap 45
  mx=$(maxv geldar_tick_frozen)
  rc 'tick unfreeze' >>"$LOG"
  FROZEN=0
  nap 45
  fz=$(lastv geldar_tick_frozen)
  rc 'tick rate 10' >>"$LOG"
  nap 45
  t10=$(lastv geldar_tick_rate_target)
  rc 'tick rate 20' >>"$LOG"
  nap 45
  t20=$(lastv geldar_tick_rate_target)
  GOT="frozen_max=$mx after=$fz target=$t10,$t20"
  isnum "$mx" && isnum "$fz" && isnum "$t10" && isnum "$t20" && ok "$mx == 1 && $fz == 0 && $t10 == 10 && $t20 == 20"
}
row_T6() {
  WANT="spark gauges within 0.5 of geldar_tps 1m"
  if ! docker exec "$PAPER" sh -c 'ls /data/plugins/spark*.jar' >>"$LOG" 2>&1; then
    SKIP_REASON="no-spark-jar"
    GOT="none"
    return 2
  fi
  SINCE=$(lines_now)
  nap 30
  sp=$(lastv geldar_spark_tps)
  tp=$(lastv geldar_tps@window=1m)
  GOT="spark=$sp tps=$tp"
  isnum "$sp" && isnum "$tp" && ok "($sp - $tp) <= 0.5 && ($tp - $sp) <= 0.5"
}
row_S1() {
  WANT="online equals list; operators 1 after op, 0 after deop"
  n=$(rc list | sed -n 's/^There are \([0-9]*\) of a max.*/\1/p' | head -n 1)
  nap 75
  SINCE=$(lines_now)
  on=$(lastv geldar_players_online)
  rc 'op Tester' >>"$LOG"
  nap 75
  o1=$(lastv geldar_operators_count)
  rc 'deop Tester' >>"$LOG"
  nap 75
  o0=$(lastv geldar_operators_count)
  GOT="list=${n:-none} online=$on ops=$o1,$o0"
  isnum "$n" && isnum "$on" && isnum "$o1" && isnum "$o0" && ok "$on == $n && $o1 == 1 && $o0 == 0"
}
row_V6() {
  WANT="geldar_plugins_enabled 2 (plugin_enabled event: not driven)"
  SINCE=$(lines_now)
  nap 30
  p=$(lastv geldar_plugins_enabled)
  GOT="plugins_enabled=$p plugin_enabled_event=not-driven"
  isnum "$p" && ok "$p == 2"
}
write_profile() { # $1 = extra lines; replaces the key enabled when $2 is given
  { if [ -n "${2:-}" ]; then grep -v "^$2=" "$ORIG"; else cat "$ORIG"; fi; printf '%s\n' "$1"; } >"$OUT/profile.new.$$"
  cat "$OUT/profile.new.$$" >"$PROFILE"
  rm -f "$OUT/profile.new.$$"
}
restore_profile() { cat "$ORIG" >"$PROFILE"; }
row_G1() {
  WANT="census disabled=1 within 30s, one event; 0 after reset"
  SINCE=$(lines_now)
  write_profile 'collector.census.budget_max_us=1
collector.census.budget_avg_us=1'
  nap 45
  mx=$(maxv geldar_paper_collector_disabled@collector=census)
  ev=$(vf event geldar.collector.disabled census | sed -n 's/^count=//p')
  restore_profile
  SINCE=$(lines_now)
  nap 45
  z=$(lastv geldar_paper_collector_disabled@collector=census)
  GOT="max=$mx event_count=$ev after_reset=$z"
  isnum "$mx" && isnum "$ev" && isnum "$z" && ok "$mx == 1 && $ev == 2 && $z == 0"
}
row_X4() {
  WANT="rcon record text say ledger-rcon-1, subtype rcon, no address"
  SINCE=$(lines_now)
  rc 'say ledger-rcon-1' >>"$LOG"
  nap 30
  e=$(vf event geldar.rcon.command 'say ledger-rcon-1' | head -n 2 | tr '\n' ' ')
  rec=$(sink_lines | grep -F 'geldar.rcon.command')
  ip=$(echo "$rec" | grep -c -E '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')
  GOT="found=$(echo "$e" | grep -c 'say ledger-rcon-1') rcon_subtype=$(echo "$rec" | grep -c 'rcon') address_lines=$ip"
  echo "$e" | grep -q 'say ledger-rcon-1' && echo "$rec" | grep -q '"rcon"\|rcon' && [ "$ip" -eq 0 ]
}
row_X6() {
  WANT="no password, no 127.0.0.1, no IPv4 in geldar.* attributes"
  SINCE=0
  pw=0
  if [ -s "$STATE/rcon.txt" ]; then
    # The password is matched through -f, never put on a command line or printed.
    grep -F -q -f "$STATE/rcon.txt" "$OUT"/*.jsonl 2>/dev/null && pw=1
  else
    pw=-1
  fi
  lo=0
  sh "$VERIFY" absent 127.0.0.1 >>"$LOG" 2>&1 || lo=1
  ips=$(cat "$OUT"/*.jsonl | grep -o -E '"key":"geldar[A-Za-z0-9_.]*","value":\{"stringValue":"[^"]*"' |
    grep -E '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | grep -v -c '0\.0\.0\.0')
  GOT="password_hits=$pw loopback_hits=$lo geldar_ipv4=$ips"
  [ "$pw" -eq 0 ] && [ "$lo" -eq 0 ] && [ "$ips" -eq 0 ]
}
row_D1() {
  WANT="geldar_disk_bytes within 1% of du -sb /data/world"
  SINCE=0
  m=$(lastv geldar_disk_bytes)
  if ! isnum "$m"; then
    nap 70
    m=$(lastv geldar_disk_bytes)
  fi
  du=$(docker exec "$PAPER" du -sb /data/world 2>>"$LOG" | awk '{print $1}')
  GOT="metric=$m du=$du"
  isnum "$m" && isnum "$du" && ok "($m - $du) <= 0.01 * $du && ($du - $m) <= 0.01 * $du"
}
row_K1() {
  WANT="no growth while enabled=false; resumes with true; plugins lists Ledger"
  SINCE=$(lines_now)
  nap 30
  a=$(lastv geldar_event_count_total)
  nap 30
  b=$(lastv geldar_event_count_total)
  write_profile 'enabled=false' enabled
  nap 20
  c=$(lastv geldar_event_count_total)
  nap 30
  d=$(lastv geldar_event_count_total)
  restore_profile
  nap 30
  e=$(lastv geldar_event_count_total)
  nap 30
  f=$(lastv geldar_event_count_total)
  pl=$(rc plugins | grep -c Ledger)
  GOT="on=$a,$b off=$c,$d on_again=$e,$f ledger_listed=$pl"
  isnum "$a" && isnum "$b" && isnum "$c" && isnum "$d" && isnum "$e" && isnum "$f" &&
    ok "$b > $a && $d == $c && $f > $e" && [ "$pl" -ge 1 ]
}
# The default stack again: no override, the operator's own environment (agent jar included). Needs the compose files.
wait_healthy() {
  i=0
  while [ "$i" -lt 40 ]; do
    sleep 15
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PAPER" 2>>"$LOG")" = healthy ] && return 0
    i=$((i + 1))
  done
  return 1
}
stack_default() {
  EXTRA_F=''
  ARM_OFF=0
  # SCRATCH_OTEL_AGENT_JAR, SCRATCH_TELEMETRY_OUT and SCRATCH_NATS_AUTH_DIR come from the operator's environment.
  compose_run up -d --no-deps paper >>"$LOG" 2>&1 && wait_healthy && return 0
  STACK_OK=0
  return 1
}
compose_env() { # the variables scratch.sh sets itself (set_env, load_ports); same values for the same project
  GELDAR_WORLD_VOLUME=${PROJECT}_paper-data
  SCRATCH_SECRETS_DIR=$STATE
  SCRATCH_RUN_UID=$(id -u)
  SCRATCH_RUN_GID=$(id -g)
  export GELDAR_WORLD_VOLUME SCRATCH_SECRETS_DIR SCRATCH_RUN_UID SCRATCH_RUN_GID
  [ -f "$HERE/telemetry.env" ] || return 0
  while IFS='=' read -r k v || [ -n "$k" ]; do
    case "$k" in
      SCRATCH_PG_PORT | SCRATCH_NATS_PORT | SCRATCH_NATS_MON_PORT | SCRATCH_MC_PORT | SCRATCH_RCON_PORT)
        eval "cur=\${$k:-}"
        [ -n "$cur" ] || export "$k=$v"
        ;;
    esac
  done <"$HERE/telemetry.env"
}
recreate() {
  compose_run up -d --no-deps --force-recreate paper >>"$LOG" 2>&1 || return 1
  PAPER=$(by_service paper)
  wait_healthy
}
row_R1() {
  WANT="paper healthy, no Ledger in plugins, no Ledger error"
  mkdir -p "$OUT/r1-empty"
  printf 'services:\n  paper:\n    volumes:\n      - %s:/plugins/ledger.jar:ro\n' "$OUT/r1-empty" >"$OUT/r1-override.yml"
  docker exec "$PAPER" rm -f /data/plugins/ledger.jar >>"$LOG" 2>&1 # the copy a previous start left in the data volume
  EXTRA_F=$OUT/r1-override.yml
  ARM_OFF=1
  if recreate; then
    p=$(rc plugins | grep -c Ledger)
    er=$(docker logs "$PAPER" 2>&1 | grep -i ledger | grep -c -E 'ERROR|SEVERE')
    GOT="healthy=yes ledger_in_plugins=$p ledger_errors=$er"
    stack_default
    [ "$p" -eq 0 ] && [ "$er" -eq 0 ]
  else
    GOT="paper-not-healthy"
    stack_default
    return 1
  fi
}
row_N1() {
  WANT="agentPresent=false once, no geldar_ points, plugins load"
  [ -n "${SCRATCH_OTEL_AGENT_JAR:-}" ] || { SKIP_REASON="agent-jar-not-set-at-start"; GOT="none"; return 2; }
  ARM_OFF=1
  if (unset SCRATCH_OTEL_AGENT_JAR; recreate); then
    SINCE=$(lines_now)
    nap 60
    ap=$(docker logs "$PAPER" 2>&1 | grep -c 'agentPresent=false')
    pts=$(sink_lines | grep -c '"name":"geldar_')
    pl=$(rc plugins | grep -c -E 'Ledger|GeldarCore|Geldar-Core')
    GOT="agentPresent_false_lines=$ap geldar_points=$pts plugins=$pl"
    [ "$ap" -eq 1 ] && [ "$pts" -eq 0 ] && [ "$pl" -ge 1 ] && return 0
    stack_default
    return 1
  fi
  GOT="paper-not-healthy"
  stack_default
  return 1
}
row_N2() {
  WANT="agent off: both plugins, no LinkageError; agent on: publisher and hearing metrics, scope geldar-core"
  off_l=$(docker logs "$PAPER" 2>&1 | grep -c -E 'LinkageError|traceparent')
  off_p=$(rc plugins | grep -c -E 'Ledger|GeldarCore|Geldar-Core')
  stack_default || { GOT="restore-failed"; return 1; }
  SINCE=$(lines_now)
  nap 90
  on_l=$(docker logs "$PAPER" 2>&1 | grep -c 'LinkageError')
  pub=$(lastv geldar_publisher_published_total)
  hear=$(lastv geldar_hearing_sent_total)
  sc=$(sink_lines | grep -c '"geldar-core"')
  GOT="off_errors=$off_l off_plugins=$off_p on_errors=$on_l publisher=$pub hearing=$hear scope=$sc"
  [ "$off_l" -eq 0 ] && [ "$off_p" -ge 1 ] && [ "$on_l" -eq 0 ] && isnum "$pub" && isnum "$hear" && [ "$sc" -ge 1 ]
}
row_C1() {
  WANT="gauge brackets cpu.stat nr_throttled; limit 16106127360 (default cpus, not the cpus=1 arm)"
  SINCE=$(lines_now)
  nap 20
  g1=$(lastv geldar_container_cpu_throttled_periods_total)
  f=$(docker exec "$PAPER" cat /sys/fs/cgroup/cpu.stat 2>>"$LOG" | awk '$1 == "nr_throttled" { print $2 }')
  nap 20
  g2=$(lastv geldar_container_cpu_throttled_periods_total)
  lim=$(lastv geldar_container_memory_limit_bytes)
  GOT="gauge=$g1..$g2 file=$f limit=$lim"
  isnum "$g1" && isnum "$g2" && isnum "$f" && isnum "$lim" && ok "$g1 <= $f && $f <= $g2 && $lim == 16106127360"
}
row_Q1() {
  WANT="p95 during outage within 0.5ms of before; series resume (idle, no bench load)"
  [ -n "$SINK" ] || { SKIP_REASON="no-otel-sink-container"; GOT="none"; return 2; }
  before=$(tick_p95)
  docker pause "$SINK" >>"$LOG" 2>&1 || { GOT="pause-failed"; return 1; }
  SINK_PAUSED=1
  nap 600
  during=$(tick_p95)
  docker unpause "$SINK" >>"$LOG" 2>&1
  SINK_PAUSED=0
  SINCE=$(lines_now)
  nap 45
  after=$(tick_p95)
  pts=$(sink_lines | grep -c '"name":"geldar_tps"')
  GOT="p95_ms=$before,$during,$after resumed_exports=$pts idle=yes"
  isnum "$before" && isnum "$during" && ok "($during - $before) <= 0.5 && ($before - $during) <= 0.5" && [ "$pts" -ge 1 ]
}

# --- runner ---
PASSED=' '
FAILED=' '
RAN=' '
ANY_FAIL=0
STACK_OK=1
ARM_OFF=0
PAUSED=0
FROZEN=0
SINK_PAUSED=0
EXTRA_F=''
SUMMARY_DONE=0
emit() { # id status got want
  line="ROW $1 $2 got=$3 want=$4"
  echo "$line"
  log "$line"
}
dep_state() { # prints the first unmet dependency
  for d in $(deps_of "$1"); do
    case "$d" in
      @census) case "$PASSED" in *" @census "*) ;; *) echo "$d"; return ;; esac ;;
      @compose) [ -f "$ROOT/compose/phase0.yml" ] || { echo "$d"; return; } ;;
      @stack) [ "$STACK_OK" -eq 1 ] || { echo "$d"; return; } ;;
      *) case "$PASSED" in *" $d "*) ;; *) echo "$d"; return ;; esac ;;
    esac
  done
}
run_row() {
  id=$1
  guard
  GOT=''
  WANT=''
  SKIP_REASON=''
  unmet=$(dep_state "$id")
  if [ -n "$unmet" ]; then
    case "$FAILED" in *" ${unmet} "*) why="dep-failed:$unmet" ;; *) why="dep-not-run-or-unmet:$unmet" ;; esac
    echo "ROW $id SKIP reason=$why got=none want=dependency-met"
    log "ROW $id SKIP reason=$why"
    FAILED="$FAILED$id " # a skipped dependent also blocks its own dependents
    return
  fi
  log "row $id start"
  "row_$id"
  r=$?
  case $r in
    0) emit "$id" PASS "$GOT" "$WANT"; PASSED="$PASSED$id " ;;
    2) # a design skip (T6) is not a failure
      echo "ROW $id SKIP reason=$SKIP_REASON got=$GOT want=$WANT"
      log "ROW $id SKIP reason=$SKIP_REASON"
      PASSED="$PASSED$id "
      ;;
    *) emit "$id" FAIL "$GOT" "$WANT"; FAILED="$FAILED$id "; ANY_FAIL=1 ;;
  esac
}

restore_all() {
  [ "$PAUSED" -eq 1 ] && docker unpause "$PAPER" >>"$LOG" 2>&1
  [ "$SINK_PAUSED" -eq 1 ] && docker unpause "$SINK" >>"$LOG" 2>&1
  [ "$FROZEN" -eq 1 ] && rc 'tick unfreeze' >>"$LOG"
  rc 'tick rate 20' >>"$LOG"
  restore_profile
  if [ "$ARM_OFF" -eq 1 ]; then stack_default; fi
  END_SHA=$(sha_of "$PROFILE")
}
summary() {
  SUMMARY_DONE=1
  echo SUMMARY
  m=$(mem_now)
  echo "memory_current_bytes=$m cgroup=${CG:-none}"
  echo "nr_throttled=$(awk '$1 == "nr_throttled" { print $2 }' "$CG/cpu.stat" 2>/dev/null)"
  SINCE=0
  echo "ledger_dropped_total last=$(lastv geldar_ledger_dropped_total) max=$(maxv geldar_ledger_dropped_total)"
  rc 'tick query' | while IFS= read -r l; do echo "tick_query: $l"; done
  echo "node_clock_utc start=$T_START end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ledger.properties_sha256 start=$START_SHA end=${END_SHA:-unknown}"
  echo "log=$LOG"
}
on_exit() {
  code=$?
  trap '' EXIT
  restore_all
  if [ "${END_SHA:-}" != "$START_SHA" ]; then
    echo "ABORT reason=profile-sha256-differs-after-restore"
    code=4
  fi
  [ "$SUMMARY_DONE" -eq 1 ] || summary
  rm -f "$ORIG"
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM INT HUP

compose_env
log "start $T_START"
if vf metric geldar_event_count_total >/dev/null 2>&1; then PASSED="$PASSED@census "; fi
for id in $ALL_ROWS; do
  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$id,"*) ;; *) continue ;; esac; fi
  run_row "$id"
done
[ "$ANY_FAIL" -eq 0 ] || exit 1
exit 0

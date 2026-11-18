#!/bin/sh
# Row driver for the scratch NeoForge telemetry run (project scratch-nf, SCRATCH_PLATFORM=neoforge, service `paper`, ledger mod,
# OpenTelemetry agent, OTLP sink). Modelled on telemetry-rows.sh (the Paper driver): same output contract and abort rules.
# docs/runbooks/scratch-telemetry.md, "NeoForge row driver". Copy it and telemetry-verify.sh into one directory on the node and run
# once: nohup sh telemetry-rows-nf.sh >rows-nf.out 2>&1 &
# Usage: sh telemetry-rows-nf.sh [--list | --only NF0,NF2,...]. Needs SCRATCH_TELEMETRY_OUT, docker, awk, sed, grep, sha256sum.
# Optional: SCRATCH_REPO_ROOT, SCRATCH_ROWS_PROFILE, SCRATCH_ROWS_CGROUP_DIR/_ROOT, SCRATCH_ROWS_MEMINFO, SCRATCH_ROWS_PROBE_CMD,
# SCRATCH_ROWS_SHARD (expected geldar.shard, default nf), SCRATCH_ROWS_RCON_CMD (default: rcon-cli inside the container).
# Stdout: "ROW <id> PASS|FAIL|SKIP got=<v> want=<w>", RECOVERY, ABORT and SUMMARY lines; detail in $SCRATCH_TELEMETRY_OUT/
# telemetry-rows-nf-<utc>.log. Exit: 0 no row failed, 1 a row failed, 2 usage or environment, 3 ABORT, 4 profile not restored
# (saved copy kept), 5 the server not back in its default configuration. No shellcheck here: `sh -n` and the tests only.
# Never stops, kills or removes a container: pauses the server (NF5), recreates it with `compose up --force-recreate` only when
# NF10 needs a restart (the files and working dir are the ones the container's own compose labels name), rewrites the one mounted
# ledger profile in place (cat > file keeps the inode; never sed -i) and, through `docker exec -i`, the COPY the mod reads in the
# container; both are restored from the saved original and the copy's sha256 is compared. The mount is read-only: the host file is edited.
set -u
umask 077 # the log, the saved profile and the temp files are the operator's only (as scratch.sh does)
HERE=$(cd "$(dirname "$0")" && pwd)
VERIFY=$HERE/telemetry-verify.sh
# --- Every name and path the driver assumes about the scratch NeoForge stack, in one place (a rename is one edit here).
# Assumed from geldar-neoforge's packet B on #701 (UNVERIFIED until it is merged): one switch GELDAR_NF_TELEMETRY=on|off (off
# drops the -javaagent flag and sets OTEL_SDK_DISABLED=true: no row here drives it; the soft kill is a recreate by the operator);
# host variables SCRATCH_NEOFORGE_LEDGER_JAR/_SHA256, SCRATCH_NEOFORGE_OTEL_AGENT_JAR/_PROPS, SCRATCH_LEDGER_PROPS (the driver
# reads none of them: they matter to NF10's recreate only through the environment it inherits); the agent jar and its properties
# and the ledger properties are mounted under /geldar/telemetry/; the entrypoint COPIES the ledger properties to
# /data/config/ledger.properties at every start; the ledger jar sits in /data/mods/ of the container.
PROJECT=scratch-nf
NF_SERVICE=paper # the service name in the scratch overlays
NF_PROPS_MOUNT=/geldar/telemetry/ledger.properties # read-only bind of the host profile
NF_PROPS_COPY=/data/config/ledger.properties # the copy the mod reads (written at every start by the entrypoint)
NF_MOD_JAR=/data/mods/geldar-neoforge-ledger.jar
NF_JVM_ARGS_FILE=/data/user_jvm_args.txt # itzg writes $JVM_XX_OPTS $JVM_OPTS here at every start; the entrypoint puts -javaagent in JVM_OPTS
NF_AGENT_LOG_MARK='opentelemetry-javaagent' # the agent's own startup line in the container log (attach is UNVERIFIED until the run)
NF_CHAT_ON_MARK='ledger chat export on' # logged when the chat export switch is on (it must be off)
NF_LATEST_LOG=/data/logs/latest.log
NF_MOD_LOG_MARK='Geldar Ledger' # the log line of the loaded mod (stderr, read through docker logs)
NF_TICK_HISTOGRAM=geldar_tick_lag_ms
NF_WORLD=minecraft:overworld
ROOT=${SCRATCH_REPO_ROOT:-$(cd "$HERE/../.." 2>/dev/null && pwd)}
SHARD=${SCRATCH_ROWS_SHARD:-nf}
AVAIL_MIN_KB=31457280 # 30 GiB
FALLBACK_MEM_MAX=15032385536 # 14 GiB: used only when the cgroup has no numeric memory.max
# NF9A-C (chat off, commands name-only, operator and combat) run before NF8, the identity scan of the whole journal. NF11 runs before\n# NF10: NF10 may restart the server, which would reset the memory reading. NF9D (the chat name mask) is idle with chat off: no row.
ALL_ROWS="NF0 NF1 NF2 NF3 NF4 NF5 NF6 NF7 NF9A NF9B NF9C NF8 NF11 NF10"
# Dependencies: a row whose dependency failed or did not run is skipped. NF5 needs the tick metrics NF2 proves.
deps_of() {
  case $1 in
    NF1 | NF2 | NF3 | NF4 | NF6 | NF8 | NF9A | NF9B | NF9C | NF10 | NF11) echo "NF0" ;;
    NF5) echo "NF2" ;;
    NF7) echo "NF6" ;;
  esac
}

ONLY=''
case "${1:-}" in
  --list)
    for r in $ALL_ROWS; do echo "$r deps=$(deps_of "$r" | tr ' ' ',')"; done
    exit 0
    ;;
  --only) ONLY=${2:-} ;;
  '') ;;
  *)
    echo "usage: sh telemetry-rows-nf.sh [--list | --only NF0,NF2,...]" >&2
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
LOG=$OUT/telemetry-rows-nf-$(date -u +%Y%m%dT%H%M%SZ).log
: >"$LOG"
chmod 600 "$LOG"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >>"$LOG"; }

by_service() { # every container lookup carries the project label
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' 2>>"$LOG" | head -n 1
}
PAPER=$(by_service "$NF_SERVICE")
[ -n "$PAPER" ] || { echo "no running paper container with the label com.docker.compose.project=$PROJECT" >&2; exit 2; }

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
PROFILE=${SCRATCH_ROWS_PROFILE:-}
MOUNT_SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$NF_PROPS_MOUNT"'"}}{{.Source}}{{end}}{{end}}' "$PAPER" 2>>"$LOG")
[ -n "$PROFILE" ] || PROFILE=$MOUNT_SRC
[ -f "${PROFILE:-}" ] || { echo "the mounted ledger.properties was not found (set SCRATCH_ROWS_PROFILE)" >&2; exit 2; }
ORIG=$OUT/ledger.properties.orig.$$
cat "$PROFILE" >"$ORIG"
START_SHA=$(sha_of "$PROFILE")
[ -n "$START_SHA" ] || { rm -f "$ORIG"; echo "sha256sum is needed" >&2; exit 2; }
START_INODE=$(ls -i "$PROFILE" | awk '{print $1}')
T_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "paper=$PAPER profile_sha256=$START_SHA inode=$START_INODE"
echo "RECOVERY saved_profile=$ORIG log=$LOG runbook=docs/runbooks/scratch-telemetry.md#neoforge-row-driver"

# Containers not labelled geldar.scratch=true that exist now: "name StartedAt/RestartCount", kept in memory only (other
# tenants' names stay out of the log). A change of an entry at a row boundary aborts; one that appeared or went is ignored.
non_scratch() {
  docker ps --format '{{.Names}} {{.Label "geldar.scratch"}}' 2>/dev/null | awk '$2 != "true" { print $1 }' | while read -r n; do
    s=$(docker inspect -f '{{.State.StartedAt}}/{{.RestartCount}}' "$n" 2>/dev/null)
    [ -z "$s" ] || echo "$n $s"
  done
}
ns_restarted() { # $1 = the current list; true when a container of the start list has a different StartedAt
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    cur=$(printf '%s\n' "$1" | awk -v n="${l%% *}" '$1 == n')
    [ -z "$cur" ] || [ "$cur" = "$l" ] || return 0
  done <<EOF
$NS_START
EOF
  return 1
}
NS_START=$(non_scratch)
log "scratch containers: $(docker ps --format '{{.Names}} {{.Label "geldar.scratch"}}' 2>/dev/null | awk '$2 == "true" { print $1 }' | tr '\n' ' ') non-scratch count=$(echo "$NS_START" | grep -c .)"

# The server's cgroup (v2): the hook, or the systemd or cgroupfs docker path of the CURRENT container id (a recreate changes it).
CGROOT=${SCRATCH_ROWS_CGROUP_ROOT:-/sys/fs/cgroup}
find_cg() {
  CG=${SCRATCH_ROWS_CGROUP_DIR:-}
  if [ -z "$CG" ]; then
    cid=$(docker inspect -f '{{.Id}}' "$PAPER" 2>>"$LOG")
    for c in "$CGROOT/system.slice/docker-$cid.scope" "$CGROOT/docker/$cid"; do
      [ -f "$c/memory.current" ] && CG=$c && break
    done
  fi
  # The abort threshold is 90% of the container's own limit (cgroup memory.max); 14 GiB when the limit is not a number.
  lim=$(cat "$CG/memory.max" 2>/dev/null)
  case "$lim" in '' | *[!0-9]*) MEM_LIMIT=0; MEM_MAX=$FALLBACK_MEM_MAX ;; *) MEM_LIMIT=$lim; MEM_MAX=$((lim / 10 * 9)) ;; esac
  return 0
}
refresh_paper() { # the container name and cgroup of the running server, after a recreate and at every row boundary
  PAPER=$(by_service "$NF_SERVICE")
  [ -n "$PAPER" ] || return 1
  find_cg
}
MEMINFO=${SCRATCH_ROWS_MEMINFO:-/proc/meminfo}
mem_now() { # 0 when memory.current is missing or unreadable: the guard treats 0 as blind and aborts
  m=$(cat "$CG/memory.current" 2>/dev/null)
  case "$m" in '' | *[!0-9]*) m=0 ;; esac
  echo "$m"
}
thr_now() { awk '$1 == "nr_throttled" { print $2 }' "$CG/cpu.stat" 2>/dev/null; }
find_cg
MEM_START=$(mem_now)
if [ "$MEM_START" -le 0 ]; then
  rm -f "$ORIG"
  echo "ABORT reason=no-cgroup-memory-current"
  exit 2
fi
THR_START=$(thr_now)
log "memory.current=$MEM_START limit=$MEM_LIMIT abort_above=$MEM_MAX nr_throttled=${THR_START:-none}"

abort() {
  log "ABORT $1"
  echo "ABORT reason=$1"
  exit 3
}
guard() {
  m=$(mem_now)
  [ "$m" -gt 0 ] || abort "neoforge-memory-current-unreadable"
  awk -v m="$m" -v max="$MEM_MAX" 'BEGIN { exit !(m + 0 > max + 0) }' && abort "neoforge-memory-current-above-90pct-of-limit:$m"
  a=$(awk '/^MemAvailable:/ { print $2 }' "$MEMINFO" 2>/dev/null)
  [ -n "$a" ] && [ "$a" -lt "$AVAIL_MIN_KB" ] && abort "node-MemAvailable-below-30GiB:${a}kB"
  ns_restarted "$(non_scratch)" && abort "non-scratch-container-restarted"
  return 0
}
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

SINCE=0
lines_now() { cat "$OUT"/*.jsonl 2>/dev/null | wc -l | tr -d ' '; }
vf() { SCRATCH_TELEMETRY_SINCE_LINE=$SINCE sh "$VERIFY" "$@" 2>>"$LOG"; }
lastv() { vf metric "$@" | sed -n 's/^last=//p'; }
ok() { awk "BEGIN { exit !($1) }"; }
isnum() { case "$1" in '' | none | *[!0-9.eE+-]*) return 1 ;; esac; }
rc() { if [ -n "${SCRATCH_ROWS_RCON_CMD:-}" ]; then $SCRATCH_ROWS_RCON_CMD "$1" 2>>"$LOG"; else docker exec "$PAPER" rcon-cli "$1" 2>>"$LOG"; fi; }
sink_lines() { cat "$OUT"/*.jsonl 2>/dev/null | tail -n +$((SINCE + 1)); }
# One log record per line: the sink writes one export request per line, a record starts at timeUnixNano (the collector's
# field order) or, in a hand-made fixture, at eventName. The event name is in the body and in eventName of the record.
recs() { sink_lines | sed 's/{"timeUnixNano"/\n&/g; s/{"eventName"/\n&/g'; }
attr_values() { # numeric attribute values in file order
  grep -o -E "\"key\":\"$1\",\"value\":\{\"[A-Za-z]+\":\"?-?[0-9.]+" | sed 's/.*:"\{0,1\}//'
}
str_values() { # string attribute values of key $1 in file order
  grep -o "\"key\":\"$1\",\"value\":{\"stringValue\":\"[^\"]*\"" | sed 's/.*:"\([^"]*\)"$/\1/'
}
ULID='[0-9A-HJKMNP-TV-Z]{26}'
IPV4='(^|[^0-9.])((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])([^0-9.]|$)'
IPV6='(([0-9A-Fa-f]{1,4}:){6,7}[0-9A-Fa-f]{1,4}|[Ff][Ee]80::[0-9A-Fa-f:]*|"::1")'
UUID='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
# Points and events of the ledger itself, not its own housekeeping gauges (geldar_ledger_*), in the new lines.
geldar_points() {
  sink_lines | grep -o -E '"name":"geldar_[a-z0-9_]*"|"eventName":"geldar\.[a-z._]*"' | grep -v 'geldar_ledger_' | wc -l | tr -d ' '
}
sid_strip() { sed 's/"key":"service\.instance\.id","value":{"stringValue":"[^"]*"}//g'; }
SESSION=''

# --- rows. Each sets GOT and WANT and returns 0 (pass), 1 (fail) or 2 (skip, SKIP_REASON set). ---
row_NF0() {
  WANT="batch within 2 export intervals; -javaagent in the java args; ledger.properties ro mount; ledger mod loaded"
  i=0
  while [ "$(lines_now)" -eq 0 ] && [ "$i" -lt 3 ]; do nap 15; i=$((i + 1)); done # 15 s interval, 2 intervals plus gateway batching
  batches=$(lines_now)
  cmd=$(docker exec "$PAPER" cat /proc/1/cmdline 2>>"$LOG" | tr '\0' ' ')
  via=pid1
  case "$cmd" in
    *-javaagent:*) ;;
    *java*@user_jvm_args.txt*) ;; # pid 1 is the NeoForge java process itself
    *)
      cmd=$(docker exec "$PAPER" sh -c 'for f in /proc/[0-9]*/cmdline; do tr "\0" " " <"$f"; echo; done' 2>>"$LOG" | grep 'java' | grep -E -- '-javaagent|@user_jvm_args\.txt|unix_args\.txt|-jar' | head -n 1)
      via=proc-scan
      ;;
  esac
  agent=$(echo "$cmd" | grep -o -- '-javaagent:[^ ]*' | head -n 1) # only the flags are kept: the rest of a command line stays out of the log
  xmx=$(echo "$cmd" | grep -o -- '-Xmx[^ ]*' | head -n 1)
  argfile=$(echo "$cmd" | grep -c -- '@user_jvm_args.txt')
  # The entrypoint appends the flag to JVM_OPTS and itzg writes it to user_jvm_args.txt at every start: both must carry it.
  fileflag=$(docker exec "$PAPER" cat "$NF_JVM_ARGS_FILE" 2>>"$LOG" | grep -o -- '-javaagent:[^ ]*' | head -n 1)
  agentlog=$(docker logs "$PAPER" 2>&1 | grep -c "$NF_AGENT_LOG_MARK")
  # NeoForge starts as java @user_jvm_args.txt @.../unix_args.txt: the flag is then only in the args file, never in a cmdline.
  if [ -z "$agent" ] && [ "$argfile" -gt 0 ] && [ -n "$fileflag" ] && [ "$agentlog" -ge 1 ]; then
    agent=$fileflag
    via=argfile
  fi
  log "java args via=$via agent=${agent:-none} xmx=${xmx:-none} argfile=$argfile"
  rw=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$NF_PROPS_MOUNT"'"}}{{.RW}}{{end}}{{end}}' "$PAPER" 2>>"$LOG")
  present=$(docker exec "$PAPER" sh -c "test -f $NF_PROPS_COPY && echo present" 2>>"$LOG")
  copy_sha=$(docker exec "$PAPER" sha256sum "$NF_PROPS_COPY" 2>>"$LOG" | awk '{print $1}')
  same=no
  [ -n "$copy_sha" ] && [ "$copy_sha" = "$START_SHA" ] && same=yes
  jar=$(docker exec "$PAPER" sh -c "test -f $NF_MOD_JAR && echo present" 2>>"$LOG")
  mnt=no
  [ "$MOUNT_SRC" = "$PROFILE" ] && mnt=yes
  loaded=$(docker logs "$PAPER" 2>&1 | grep -c "$NF_MOD_LOG_MARK")
  GOT="export_lines=$batches agent=$([ -n "$agent" ] && echo yes || echo no) via=$via user_jvm_args_flag=$([ -n "$fileflag" ] && echo yes || echo no) agent_log_lines=$agentlog java_flags=${xmx:+Xmx }$([ "$argfile" -gt 0 ] && echo argfile || echo cmdline) ledger_copy=${present:-missing} copy_is_mounted_file=$same mount_ro=$([ "$rw" = false ] && echo yes || echo no) mount_is_profile=$mnt mod_jar=${jar:-missing} ledger_log_lines=$loaded"
  [ "$batches" -gt 0 ] && [ -n "$agent" ] && [ -n "$fileflag" ] && [ "$agentlog" -ge 1 ] && [ "$present" = present ] && [ "$same" = yes ] && [ "$rw" = false ] && [ "$mnt" = yes ] &&
    [ "$jar" = present ] && [ "$loaded" -ge 1 ]
}
row_NF1() {
  WANT="service.name=geldar-neoforge, geldar.shard=$SHARD; no host.*, process.*, os.*, container.id, IPv4, IPv6 or UUID in resource attributes"
  SINCE=0
  res=$(cat "$OUT"/*.jsonl 2>/dev/null | grep -m 1 '"resource"' | sed -n 's/.*"resource":{"attributes":\[\([^]]*\)\].*/\1/p')
  [ -n "$res" ] || { GOT="no-resource-attributes-in-the-journal"; return 1; }
  svc=$(printf '%s' "$res" | str_values service.name | head -n 1)
  shd=$(printf '%s' "$res" | str_values geldar.shard | head -n 1)
  # Resource attribute blocks of every batch, not only the first: a restart or a late provider must not add a forbidden key.
  allres=$(cat "$OUT"/*.jsonl 2>/dev/null | grep -o '"resource":{"attributes":\[[^]]*\]')
  bad=$(printf '%s\n' "$allres" | grep -o -E '"key":"(host|process|os)\.[^"]*"|"key":"container\.id"' | sort -u | tr '\n' ' ')
  # service.instance.id is the OTel SDK's per-process UUID (kept by decision): it must be present and UUID-shaped, and only
  # that key's value is excluded from the address scan.
  sid=$(printf '%s' "$res" | str_values service.instance.id | head -n 1)
  sidok=no
  printf '%s' "$sid" | grep -q -E "^$UUID\$" && sidok=yes
  addr=$(printf '%s\n' "$allres" | sid_strip | grep -c -E "$IPV4|$IPV6|$UUID")
  GOT="service.name=${svc:-none} geldar.shard=${shd:-none} instance_id_uuid=$sidok forbidden_keys=${bad:-none} address_or_uuid_blocks=$addr"
  [ "$svc" = geldar-neoforge ] && [ "$shd" = "$SHARD" ] && [ "$sidok" = yes ] && [ -z "$bad" ] && [ "$addr" -eq 0 ]
}
# A paused empty server (pause-when-empty) has no ticks and no chunks: the row needs a human join.
no_player() { [ "$(rc list | sed -n 's/^There are \([0-9]*\) of a max.*/\1/p' | head -n 1)" = 0 ]; }
row_NF2() {
  WANT="tick lag histogram delta/elapsed 20/s +-5%"
  no_player && { SKIP_REASON=no-player-online; GOT=none; return 2; }
  SINCE=$(lines_now)
  nap 80
  hc=$(vf histcount "$NF_TICK_HISTOGRAM")
  d=$(echo "$hc" | sed -n 's/.*delta=//p')
  ex=$(sink_lines | grep -F "\"$NF_TICK_HISTOGRAM\"")
  ts() { printf '%s' "$1" | sed "s/^.*\"$NF_TICK_HISTOGRAM\"//" | grep -o -E '"timeUnixNano":"?[0-9]+' | head -n 1 | sed 's/.*:"\{0,1\}//'; }
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
row_NF3() {
  WANT="players_online equals list; mods_loaded >= 2; config_snapshot holds allow-listed keys only"
  SINCE=$(lines_now)
  nap 30
  n=$(rc list | sed -n 's/^There are \([0-9]*\) of a max.*/\1/p' | head -n 1)
  on=$(lastv geldar_players_online)
  mods=$(lastv geldar_mods_loaded)
  ops=$(lastv geldar_operators_count)
  SINCE=0 # the snapshot event is written once, 5 s after the server start
  snap=$(recs | grep -F 'geldar.server.config_snapshot' | tail -n 1)
  # One attribute geldar.text holds `name=value; name=value` (ConfigSnapshot.java): the setting names are parsed out of it.
  keys=$(printf '%s' "$snap" | str_values geldar.text | head -n 1 | tr ';' '\n' | sed 's/^ *//; s/=.*//' | sort -u | tr '\n' ',')
  forbidden=$(printf '%s' "$keys" | tr ',' '\n' | grep -c -i -E 'rcon|query|address|seed|password|secret|motd|^ip$')
  GOT="list=${n:-none} online=$on mods=$mods ops=$ops snapshot_keys=${keys%,} forbidden=$forbidden"
  isnum "$n" && isnum "$on" && isnum "$mods" && isnum "$ops" && [ -n "$snap" ] && [ "$forbidden" -eq 0 ] &&
    printf '%s' "$keys" | grep -q 'view_distance' && printf '%s' "$keys" | grep -q 'jvm_xmx' && ok "$on == $n && $mods >= 2"
}
row_NF4() {
  WANT="world gauges present and plausible (approximate by design); players per dimension equal list"
  no_player && { SKIP_REASON=no-player-online; GOT=none; return 2; }
  SINCE=$(lines_now)
  nap 30
  w=$NF_WORLD
  ch=$(lastv "geldar_world_loaded_chunks@world=$w")
  en=$(lastv "geldar_world_entities@world=$w")
  pl=$(lastv "geldar_world_players@world=$w")
  n=$(rc list | sed -n 's/^There are \([0-9]*\) of a max.*/\1/p' | head -n 1)
  srv=$(rc 'neoforge tps' | head -n 3 | tr '\n' ' ') # the server's own view for the log; no vanilla command gives a chunk total
  log "NF4 server reply (neoforge tps): $srv"
  GOT="overworld chunks=$ch entities=$en players=$pl list=${n:-none} server_chunk_count=unavailable"
  isnum "$ch" && isnum "$en" && isnum "$pl" && isnum "$n" && ok "$ch > 0 && $ch < 1000000 && $en >= 0 && $pl <= $n + 0 && $pl >= 0"
}
row_NF5() {
  WANT="stalls +1; flag=1 2000-2500ms; flag=0 4000ms +-10% (the TickCollector reuses core StallDetector, as Paper's T3)"
  no_player && { SKIP_REASON=no-player-online; GOT=none; return 2; }
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
  stall=$(recs | grep -F 'geldar.server.stall')
  flags=$(echo "$stall" | attr_values geldar.flag | tr '\n' ' ')
  durs=$(echo "$stall" | attr_values geldar.duration_ms | tr '\n' ' ')
  GOT="stalls=$s0->$s1 flags=${flags% } durations=${durs% }"
  [ "${flags% }" = "1 0" ] || return 1
  set -- $durs
  ok "$s1 - $s0 == 1 && $1 >= 2000 && $1 <= 2500 && $2 >= 3600 && $2 <= 4400"
}
row_NF6() {
  WANT="join with life_id and an ULID mc_session; quit with duration and the same session"
  PROBE=${SCRATCH_ROWS_PROBE_CMD:-}
  if [ -z "$PROBE" ]; then
    if [ -f "$ROOT/deploy/scratch/scratch.sh" ] && [ -n "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
      PROBE="sh $ROOT/deploy/scratch/scratch.sh probe nf"
    else
      SKIP_REASON="no-probe-driver"
      GOT=none
      return 2
    fi
  fi
  SINCE=$(lines_now)
  SCRATCH_PLATFORM=neoforge sh -c "$PROBE" </dev/null 2>&1 | grep '^p0 ' >>"$LOG"
  nap 45 # the quit and one more export
  jn=$(recs | grep -F 'geldar.player.join')
  qt=$(recs | grep -F 'geldar.player.quit')
  js=$(echo "$jn" | str_values geldar.mc_session | head -n 1)
  qs=$(echo "$qt" | str_values geldar.mc_session | head -n 1)
  life=$(echo "$jn" | str_values geldar.life_id | head -n 1)
  dur=$(echo "$qt" | attr_values geldar.duration_ms | head -n 1)
  [ -n "$dur" ] || dur=$(echo "$qt" | attr_values duration_ms | head -n 1)
  SESSION=$js
  GOT="join=$(echo "$jn" | grep -c .) quit=$(echo "$qt" | grep -c .) life_id=$([ -n "$life" ] && echo yes || echo no) session_ulid=$(echo "$js" | grep -c -E "^$ULID\$") same_session=$([ -n "$js" ] && [ "$js" = "$qs" ] && echo yes || echo no) duration_ms=${dur:-none}"
  [ -n "$life" ] && echo "$js" | grep -q -E "^$ULID\$" && [ "$js" = "$qs" ] && isnum "$dur"
}
row_NF7() {
  WANT="mc_session unchanged across a respawn; snapshots keep it"
  snaps=$(recs | grep -F 'geldar.player.snapshot')
  ss=$(echo "$snaps" | str_values geldar.mc_session | sort -u)
  other=$(printf '%s\n' "$ss" | grep -v -x -F "${SESSION:-none}" | grep -c .)
  GOT="snapshots=$(echo "$snaps" | grep -c .) snapshot_sessions_not_the_join_session=$other respawn=not-driven"
  [ "$other" -eq 0 ] || return 1
  SKIP_REASON="no-respawn-driver" # neither the probe nor rcon can make the probe die and respawn at a known time
  return 2
}
row_NF8() {
  WANT="no IPv4, IPv6 or UUID-shaped string anywhere in the journal (no human names exist in scratch)"
  SINCE=0
  if [ "$(lines_now)" -eq 0 ]; then
    SKIP_REASON="empty-sink"
    GOT=none
    return 2
  fi
  # A dotted quad is not an address when it is a version: attributes whose key contains "version" (server_version,
  # telemetry.sdk.version, process.runtime.version) are dropped first, and a quad that starts with `26.` (the NeoForge and
  # Minecraft release line, 26.x.y.z) is ignored; 0.0.0.0 is a bind address. Any other quad, in any attribute or body, counts.
  v4=$(cat "$OUT"/*.jsonl | sed 's/"key":"[^"]*[Vv]ersion[^"]*","value":{"[A-Za-z]*":"[^"]*"}//g' | grep -o -E "$IPV4" |
    grep -v -c -E '0\.0\.0\.0|(^|[^0-9.])26\.[0-9]+\.[0-9]+\.[0-9]+')
  v6=$(cat "$OUT"/*.jsonl | grep -c -E "$IPV6")
  ui=$(cat "$OUT"/*.jsonl | sid_strip | grep -c -E "$UUID") # service.instance.id (the SDK's per-process UUID) is the one allowed value
  GOT="ipv4_hits=$v4 ipv6_lines=$v6 uuid_lines=$ui"
  [ "$v4" -eq 0 ] && [ "$v6" -eq 0 ] && [ "$ui" -eq 0 ]
}
# The live profile: collector.audit.enabled=true, combat and operator on, collector.chat.enabled=false (the chat switch is off).
prof_val() { grep -E "^$1=" "$ORIG" | tail -n 1 | sed 's/^[^=]*=//; s/[[:space:]]*$//'; }
row_NF9A() {
  WANT="no '$NF_CHAT_ON_MARK' line in the container log or latest.log and no geldar.chat record while collector.chat.enabled=false"
  if [ "$(prof_val collector.chat.enabled)" = true ]; then
    SKIP_REASON="chat-enabled-in-profile"
    GOT="collector.chat.enabled=true"
    return 2
  fi
  cl=$(docker logs "$PAPER" 2>&1 | grep -c "$NF_CHAT_ON_MARK")
  ll=$(docker exec "$PAPER" sh -c "grep -c '$NF_CHAT_ON_MARK' $NF_LATEST_LOG 2>/dev/null; true" 2>>"$LOG" | head -n 1)
  case "$ll" in '' | *[!0-9]*) lln=0; ll=unreadable ;; *) lln=$ll ;; esac # an unreadable latest.log is reported, not a pass by itself
  SINCE=0
  vf absent geldar.chat >/dev/null
  ch=$?
  GOT="container_log_hits=$cl latest_log_hits=$ll chat_records=$([ "$ch" -eq 0 ] && echo 0 || echo present)"
  [ "$cl" -eq 0 ] && [ "$lln" -eq 0 ] && [ "$ch" -eq 0 ]
}
row_NF9B() {
  WANT="rcon commands export the root name only: say amount=1, msg amount=2, a non-root exports unknown; no argument text anywhere in the journal"
  if [ "$(prof_val collector.audit.enabled)" != true ]; then
    SKIP_REASON="audit-not-true-in-profile"
    GOT="collector.audit.enabled=$(prof_val collector.audit.enabled)"
    return 2
  fi
  SINCE=$(lines_now)
  rc 'say marker-argument-xyz' >>"$LOG"
  rc 'msg ag_nfprobe_01 secret-arg-abc' >>"$LOG"
  rc 'rcon hunter2 x' >>"$LOG" # not a registered command root
  nap 45
  rr=$(recs | grep -F 'geldar.rcon.command')
  say_n=$(echo "$rr" | grep -F '"stringValue":"say"' | attr_values geldar.amount | head -n 1)
  msg_n=$(echo "$rr" | grep -F '"stringValue":"msg"' | attr_values geldar.amount | head -n 1)
  unk=$(echo "$rr" | grep -c -F '"stringValue":"unknown"')
  SINCE=0
  leaked=0
  for s in marker-argument-xyz secret-arg-abc hunter2; do vf absent "$s" >/dev/null || leaked=$((leaked + 1)); done
  GOT="say_amount=${say_n:-none} msg_amount=${msg_n:-none} unknown_records=$unk leaked_argument_strings=$leaked"
  [ "$say_n" = 1 ] && [ "$msg_n" = 2 ] && [ "$unk" -ge 1 ] && [ "$leaked" -eq 0 ]
}
row_NF9C() {
  WANT="op then deop of an online agent: geldar.operator.change flags 1 then 0; kill: geldar.combat.player_death with the agent life_id; no driver when no agent is online"
  who=$(rc list | sed -n 's/^[^:]*://p' | tr ', ' '\n\n' | grep -E '^ag_[a-z0-9_]+$' | head -n 1)
  if [ -z "$who" ]; then # operator.change is for online players only and a dead player needs a body: the probe has left by now
    SKIP_REASON="no-driver"
    GOT="no-agent-online"
    return 2
  fi
  SINCE=$(lines_now)
  rc "op $who" >>"$LOG"
  rc "deop $who" >>"$LOG"
  rc "kill $who" >>"$LOG"
  nap 45
  fl=$(recs | grep -F 'geldar.operator.change' | attr_values geldar.flag | tr '\n' ' ')
  dth=$(recs | grep -F 'geldar.combat.player_death' | str_values geldar.life_id | grep -c -x -F "$who")
  GOT="operator_flags=${fl% } player_death_with_life_id=$dth"
  [ "${fl% }" = "1 0" ] && [ "$dth" -ge 1 ]
}
row_NF11() {
  WANT="memory.current below 90% of the container limit; java RSS, nr_throttled and the start values recorded"
  m=$(mem_now)
  thr=$(thr_now)
  rss=$(docker exec "$PAPER" sh -c 'for d in /proc/[0-9]*; do tr "\0" " " <"$d/cmdline" | grep -q java && { grep VmRSS "$d/status"; break; }; done' 2>>"$LOG" | awk '{print $2}')
  GOT="memory_current=$MEM_START->$m limit=$MEM_LIMIT nr_throttled=${THR_START:-none}->${thr:-none} java_rss_kb=${rss:-none}"
  isnum "$m" && [ "$m" -gt 0 ] && [ "$m" -le "$MEM_MAX" ] && isnum "$rss"
}
write_profile() { # $1 = extra lines; replaces the key $2 when given
  { if [ -n "${2:-}" ]; then grep -v "^$2=" "$ORIG"; else cat "$ORIG"; fi; printf '%s\n' "$1"; } >"$OUT/profile.new.$$"
  cat "$OUT/profile.new.$$" >"$PROFILE"
  rm -f "$OUT/profile.new.$$"
}
restore_profile() { cat "$ORIG" >"$PROFILE"; }
# The mod reads the COPY in the container (the entrypoint copies the mounted host file at every start). `cat >` keeps the inode;
# the copy's own sha256 is checked against the profile's start sha256 after the restore.
COPY_DIRTY=0
write_copy() { docker exec -i "$PAPER" sh -c "cat >$NF_PROPS_COPY" <"$1" >>"$LOG" 2>&1; }
copy_sha() { docker exec "$PAPER" sha256sum "$NF_PROPS_COPY" 2>>"$LOG" | awk '{print $1}'; }
wait_healthy() {
  i=0
  while [ "$i" -lt 40 ]; do
    sleep 15
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PAPER" 2>>"$LOG")" = healthy ] && return 0
    i=$((i + 1))
  done
  return 1
}
# Recreates the server with exactly the files and working dir its own compose labels name, in the project scope; the
# SCRATCH_* and GELDAR_NF_* variables of the shell that ran scratch.sh up must be exported (compose refuses without them,
# before it touches anything).
compose_run() { # $COMPOSE_ARGS after the labelled files, in the project scope
  cf=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$PAPER" 2>>"$LOG")
  wd=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$PAPER" 2>>"$LOG")
  [ -n "$cf" ] && [ -n "$wd" ] || return 1
  (
    IFS=,
    set --
    for f in $cf; do set -- "$@" -f "$f"; done
    IFS=' '
    docker compose -p "$PROJECT" --project-directory "$wd" "$@" $COMPOSE_ARGS
  ) >>"$LOG" 2>&1
}
recreate() {
  COMPOSE_ARGS='up -d --no-deps --force-recreate paper' compose_run || return 1
  refresh_paper && wait_healthy
}
started_at() { docker inspect -f '{{.State.StartedAt}}' "$PAPER" 2>>"$LOG"; }
STACK_WHY=''
stack_default() {
  ARM_OFF=0
  s0=$(started_at)
  recreate && return 0
  if [ "$(started_at)" = "$s0" ]; then # compose refused before touching anything: the stack is intact, restore_all rewrites the copy
    log "stack: the container was not recreated (StartedAt unchanged)"
    return 1
  fi
  STACK_WHY=recreated-but-not-healthy
  STACK_OK=0
  return 1
}
copy_stat() { docker exec "$PAPER" stat -c '%U %a' "$NF_PROPS_COPY" 2>>"$LOG"; }
COPY_TOUCHED=0
COPY_STAT0=''
RESTORE_BAD=0
row_NF10() {
  WANT="no geldar points 15 s plus one export after enabled=false (live reload, else after one restart); resume after restore"
  COMPOSE_ARGS='config -q' compose_run || { SKIP_REASON=env-not-exported; GOT="compose-config-failed (export the SCRATCH_* and GELDAR_NF_* variables)"; return 2; }
  SINCE=$(lines_now)
  write_profile 'enabled=false' enabled
  COPY_STAT0=$(copy_stat)
  COPY_TOUCHED=1
  COPY_DIRTY=1
  write_copy "$PROFILE" || log "NF10: the copy in the container could not be written"
  nap 30 # 15 s plus one 15 s export
  SINCE=$(lines_now)
  nap 20
  c1=$(geldar_points)
  mode=live
  if [ "$c1" -gt 0 ]; then # the mod reads the file at start only (nf-live-telemetry.md): one restart applies it
    mode=restart
    ARM_OFF=1
    recreate || { GOT="live-edit-ignored restart-failed"; return 1; }
    nap 30
    SINCE=$(lines_now)
    nap 20
    c1=$(geldar_points)
  fi
  restore_profile
  if [ "$mode" = live ]; then write_copy "$ORIG"; else stack_default || { GOT="mode=$mode restore-failed"; return 1; }; fi
  COPY_DIRTY=0 # after a restart the new copy was made from the restored host file
  cs=$(copy_sha)
  back=no
  [ -n "$cs" ] && [ "$cs" = "$START_SHA" ] && back=yes
  nap 30
  SINCE=$(lines_now)
  nap 45
  c2=$(geldar_points)
  GOT="mode=$mode points_while_off=$c1 points_after_restore=$c2 copy_restored=$back"
  [ "$c1" -eq 0 ] && [ "$c2" -gt 0 ] && [ "$back" = yes ]
}

PASSED=' '
FAILED=' '
ANY_FAIL=0
STACK_OK=1
ARM_OFF=0
PAUSED=0
SUMMARY_DONE=0
emit() { # id status got want
  line="ROW $1 $2 got=$3 want=$4"
  echo "$line"
  log "$line"
}
dep_state() { # prints the first unmet dependency. NF0 (environment) is soft: only a failed NF0 skips, so --only NF2 still runs.
  for d in $(deps_of "$1"); do
    if [ "$d" = NF0 ]; then
      case "$FAILED" in *" NF0 "*) echo "$d"; return ;; esac
      continue
    fi
    case "$PASSED" in *" $d "*) ;; *) echo "$d"; return ;; esac
  done
}
run_row() {
  id=$1
  refresh_paper || abort "neoforge-container-not-found"
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
    2) # a design skip (NF7, NF9A-C without a driver or with the wrong profile, no probe driver) is not a failure
      echo "ROW $id SKIP reason=$SKIP_REASON got=$GOT want=$WANT"
      log "ROW $id SKIP reason=$SKIP_REASON"
      PASSED="$PASSED$id "
      ;;
    *) emit "$id" FAIL "$GOT" "$WANT"; FAILED="$FAILED$id "; ANY_FAIL=1 ;;
  esac
}

restore_all() {
  [ "$PAUSED" -eq 1 ] && docker unpause "$PAPER" >>"$LOG" 2>&1
  restore_profile
  # The copy is rewritten whenever it is still dirty, whatever ARM_OFF says: a failed recreate leaves the old container and the edited copy.
  if [ "$ARM_OFF" -eq 1 ] && stack_default; then COPY_DIRTY=0; fi
  if [ "$COPY_DIRTY" -eq 1 ]; then write_copy "$ORIG"; fi
  if [ "$COPY_TOUCHED" -eq 1 ]; then
    cs=$(copy_sha)
    st1=$(copy_stat)
    if [ "$cs" != "$START_SHA" ]; then
      echo "RESTORE-FAILED copy_sha=${cs:-none} want=$START_SHA"
      RESTORE_BAD=1
    fi
    if [ "$st1" != "$COPY_STAT0" ]; then
      echo "ABORT reason=copy-owner-or-mode-changed before='$COPY_STAT0' after='$st1'"
      RESTORE_BAD=1
    fi
  fi
  END_SHA=$(sha_of "$PROFILE")
}
summary() {
  SUMMARY_DONE=1
  echo SUMMARY
  m=$(mem_now)
  echo "memory_current_bytes=$m cgroup=${CG:-none} limit=$MEM_LIMIT start=$MEM_START"
  echo "nr_throttled=$(thr_now) start=${THR_START:-none}"
  SINCE=0
  d=$(lastv geldar_ledger_dropped_total)
  echo "ledger_dropped_total last=${d:-none}"
  rc 'tick query' | while IFS= read -r l; do echo "tick_query: $l"; done
  echo "chat_name_mask=idle (NF9d: collector.chat.enabled=false, nothing to test live)"
  echo "shutdown_flush=not-a-row (NF12: stop the stack by hand and check the last export in the journal)"
  echo "node_clock_utc start=$T_START end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ledger.properties_sha256 start=$START_SHA end=${END_SHA:-unknown}"
  echo "log=$LOG"
}
on_exit() {
  code=$?
  trap '' EXIT TERM INT HUP # a second signal must not cut the restore short
  restore_all
  if [ "${END_SHA:-}" != "$START_SHA" ]; then
    echo "ABORT reason=profile-sha256-differs-after-restore saved_profile=$ORIG" # the saved copy is kept
    code=4
  elif [ "$RESTORE_BAD" -eq 1 ]; then
    echo "ABORT reason=copy-not-restored saved_profile=$ORIG" # the saved copy is kept
    code=6
  else
    rm -f "$ORIG"
  fi
  if [ "$STACK_OK" -eq 0 ]; then
    echo "ABORT reason=default-stack-not-restored cause=${STACK_WHY:-recreate-failed}"
    code=5
  fi
  [ "$SUMMARY_DONE" -eq 1 ] || summary
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM INT HUP

log "start $T_START"
for id in $ALL_ROWS; do
  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$id,"*) ;; *) continue ;; esac; fi
  run_row "$id"
done
[ "$ANY_FAIL" -eq 0 ] || exit 1
exit 0

# The optional extra mod jars (Chunky, BlueMap; the allowlist is compose/neoforge/extra-mods.pins). Sourced by deploy/nf-deploy.sh,
# which defines die, need, say and check_host_file, and sets ROOT. POSIX sh. NF_EXTRA_MODS unset or empty enables nothing, and then
# no check here runs and the compose calls are unchanged. For each enabled name the host jar (NF_EXTRA_<NAME>_JAR_HOST) is checked
# before any docker call: an absolute regular non-symlink file whose sha256 equals the pin in the pins file.
EXTRA_PINS=$ROOT/compose/neoforge/extra-mods.pins
# The enabled names, in pins-file order. Set by check_extra_mods.
EXTRA_ENABLED=""

# extra_allowed NAME: true when NAME is a name in the pins file (the allowlist).
extra_allowed() {
  awk -v n="$1" '$0 !~ /^#/ && $1 == n { found = 1 } END { exit !found }' "$EXTRA_PINS"
}

# extra_pin NAME: the pinned sha256 of NAME, from the pins file (empty when NAME is not listed).
extra_pin() {
  awk -v n="$1" '$0 !~ /^#/ && $1 == n { print $2; exit }' "$EXTRA_PINS"
}

# check_extra_jar NAME: the host jar for NAME must be a regular file (check_host_file) whose sha256 equals the pin. Hashed on stdin,
# like the other jar checks, so the path is never passed to sha256sum. Only the names are printed, never the bytes.
check_extra_jar() {
  up=$(printf '%s' "$1" | tr 'a-z' 'A-Z')
  var=NF_EXTRA_${up}_JAR_HOST
  eval "jar=\${$var:-}"
  [ -n "$jar" ] || die "$var is not set (NF_EXTRA_MODS names $1)"
  check_host_file "$var" "$jar"
  want=$(extra_pin "$1")
  need sha256sum
  got=$(sha256sum <"$jar" | awk '{print $1}')
  [ "$got" = "$want" ] || die "the sha256 of the $1 jar ($var) does not match its pin in compose/neoforge/extra-mods.pins; nothing started"
}

# check_extra_mods: parses NF_EXTRA_MODS (names separated by commas or spaces) and checks each enabled jar. Refused: a character
# outside letters, digits, underscore, comma and space; an empty entry; a name not in the allowlist; a name given twice.
check_extra_mods() {
  EXTRA_ENABLED=""
  dups=$(awk '$0 !~ /^#/ && NF > 0 { print $1 }' "$EXTRA_PINS" | sort | uniq -d | tr '\n' ' ')
  [ -z "$dups" ] || die "compose/neoforge/extra-mods.pins lists ${dups% } more than once; refusing"
  raw=${NF_EXTRA_MODS:-}
  [ -n "$raw" ] || return 0
  # NF_EXTRA_MODS=none is the deliberate "no extra mods": nothing is enabled, and check_extra_mods_drop lets it through.
  if [ "$raw" = none ]; then return 0; fi
  case $raw in
    *[!A-Za-z0-9_,\ ]*) die "NF_EXTRA_MODS has a character outside letters, digits, underscore, comma and space (a tab or a newline counts); refusing" ;;
  esac
  squeezed=$(printf '%s' "$raw" | tr -d ' ')
  case $squeezed in
    ,* | *, | *,,*) die "NF_EXTRA_MODS has an empty entry (a leading, trailing or doubled comma); refusing" ;;
  esac
  seen=""
  # The loop variable is not "name": check_host_file (deploy/nf-deploy.sh) sets a global name, which clobbered this loop once.
  for mod in $(printf '%s' "$raw" | tr ',' ' '); do
    if [ "$mod" = none ]; then die "NF_EXTRA_MODS=none cannot be combined with other names; refusing"; fi
    extra_allowed "$mod" || die "NF_EXTRA_MODS names $mod, which is not in compose/neoforge/extra-mods.pins; refusing"
    case " $seen " in
      *" $mod "*) die "NF_EXTRA_MODS names $mod more than once; refusing" ;;
    esac
    seen="$seen $mod"
  done
  for mod in $(awk '$0 !~ /^#/ && NF > 0 { print $1 }' "$EXTRA_PINS"); do
    case " $seen " in
      *" $mod "*)
        check_extra_jar "$mod"
        EXTRA_ENABLED="$EXTRA_ENABLED $mod"
        ;;
    esac
  done
  EXTRA_ENABLED=${EXTRA_ENABLED# }
  case " $EXTRA_ENABLED " in
    *" bluemap "*) check_bluemap_bundle; check_bluemap_loader ;;
  esac
  if [ -n "$EXTRA_ENABLED" ]; then
    say "extra mods: the host jars match their pins (no docker call made yet)"
  fi
}

# check_extra_mods_drop:with NF_EXTRA_MODS unset or empty, a running neoforge container that still has extra mod jars mounted
# would be recreated without them, so the run is refused before any compose call. Any non-empty value passes here (check_extra_mods
# has parsed it; NF_EXTRA_MODS=none is the deliberate removal). Read-only docker calls: ps (the project's neoforge rows), then
# inspect (the mounts of each row). A failure of either refuses. Mounts under /geldar/extra-mods are mods, except bluemap-config.
check_extra_mods_drop() {
  case ${NF_EXTRA_MODS:-} in
    '') ;;
    *) return 0 ;;
  esac
  rows=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=neoforge" \
    --format '{{.ID}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}') ||
    die "cannot list the $PROJECT containers (extra mods check); refusing"
  ids=$(printf '%s\n' "$rows" | awk -F'|' -v p="$PROJECT" '$2 == p && $3 == "neoforge" { print $1 }')
  all=""
  for id in $ids; do
    mounts=$(docker inspect --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' "$id") ||
      die "cannot inspect the neoforge container (extra mods check); refusing"
    all="$all$mounts
"
  done
  names=$(printf '%s\n' "$all" | awk 'index($0, "/geldar/extra-mods") == 1 && $0 != "/geldar/extra-mods/bluemap-config" { n = substr($0, 19); sub(/^\//, "", n); sub(/\.jar$/, "", n); if (n == "") n = $0; printf "%s%s", (c++ ? "," : ""), n }')
  [ -z "$names" ] || die "the running neoforge container has extra mods mounted ($names) but NF_EXTRA_MODS is unset: it would be recreated WITHOUT them; source the ops env file that sets NF_EXTRA_MODS (a sourced shell file in the ops user's home on the node), or set NF_EXTRA_MODS=none to remove them on purpose"
}

# BlueMap's committed config bundle, mounted into the container by compose/nf-live-mod-bluemap.yml. Tests point it at a fixture.
BLUEMAP_BUNDLE=$ROOT/plugins/bluemap/neoforge

# check_bluemap_bundle: with BlueMap enabled, the bundle must match its MANIFEST.sha256 before any docker call: a regular directory, a
# regular manifest, every listed file a regular non-symlink file with its sha256, no symlink, and no other file in the directory (a stray
# default would be installed). The first problem is named; file contents are never printed.
check_bluemap_bundle() {
  b=$BLUEMAP_BUNDLE
  [ -d "$b" ] && [ ! -L "$b" ] || die "BlueMap is enabled but its config bundle $b is not a directory; refusing"
  m=$b/MANIFEST.sha256
  [ -f "$m" ] && [ ! -L "$m" ] || die "BlueMap is enabled but $m is missing or not a regular file; refusing"
  [ -s "$m" ] && [ -z "$(tail -c 1 "$m")" ] || die "the BlueMap MANIFEST.sha256 is empty or has no final newline; refusing"
  link=$(cd "$b" && find . -type l | head -n 1)
  [ -z "$link" ] || die "the BlueMap config bundle holds a symlink ($link); refusing"
  [ -z "$(tr -cd '\r' < "$m")" ] || die "the BlueMap MANIFEST.sha256 has CR line endings (CRLF), not LF; refusing"
  bad=$(awk 'NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-f]/ || $2 !~ /^([A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.conf$/ { print NR; exit }' "$m")
  [ -z "$bad" ] || die "the BlueMap MANIFEST.sha256 line $bad is not '<sha256>  <path>'; refusing"
  while read -r want rel || [ -n "$want" ]; do
    f=$b/$rel
    [ -f "$f" ] && [ ! -L "$f" ] || die "the BlueMap config bundle lacks the regular file $rel; refusing"
    got=$(sha256sum <"$f" | awk '{print $1}')
    [ "$got" = "$want" ] || die "the BlueMap config bundle file $rel does not match MANIFEST.sha256; refusing"
  done <"$m"
  want_list=$(awk 'NF > 0 { print $2 }' "$m"; echo MANIFEST.sha256)
  for f in $(cd "$b" && find . -type f | sed 's|^\./||' | LC_ALL=C sort); do
    printf '%s\n' "$want_list" | grep -qxF -- "$f" || die "the BlueMap config bundle holds $f, which MANIFEST.sha256 does not list; refusing"
  done
}

# The BlueMap config loader (compose/neoforge/extra-mods-bluemap-config.sh) is sourced by the entrypoint, so it is checked here too: the
# same sha256 the BlueMap overlays pin (a test asserts the pins equal this constant and the file). A changed loader is refused before docker.
BLUEMAP_LOADER=$ROOT/compose/neoforge/extra-mods-bluemap-config.sh
BLUEMAP_LOADER_SHA256=f80bdfe6392912b666f7a10be57d023c5a79de6199262be9e198894df1193cad

# check_bluemap_loader: a regular, non-symlink file whose sha256 is BLUEMAP_LOADER_SHA256. Refused before any docker call otherwise.
check_bluemap_loader() {
  f=$BLUEMAP_LOADER
  [ -f "$f" ] && [ ! -L "$f" ] || die "BlueMap is enabled but its config loader $f is missing or not a regular file; refusing"
  got=$(sha256sum <"$f" | awk '{print $1}')
  [ "$got" = "$BLUEMAP_LOADER_SHA256" ] || die "the BlueMap config loader $f does not match its pinned sha256; refusing (regenerate the pin with: sha256sum $f)"
}

# extra_plan_lines: one plan line per enabled mod, with its version and the first 12 hex digits of its pin.
extra_plan_lines() {
  for mod in $EXTRA_ENABLED; do
    ver=$(awk -v n="$mod" '$0 !~ /^#/ && $1 == n { print $4 }' "$EXTRA_PINS")
    say "extra mod $mod $ver (sha256 $(extra_pin "$mod" | cut -c1-12)...): overlay compose/nf-live-mod-$mod.yml is added; the entrypoint copies the pinned jar into mods/"
  done
}

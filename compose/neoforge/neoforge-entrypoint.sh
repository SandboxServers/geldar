#!/bin/sh
# Entrypoint for the scratch NeoForge variant (compose/opt-in/scratch-neoforge.yml): wraps the image's start script. It fetches the
# NeoForge installer and the Proxy Compatible Forge mod, each checked against a pinned hash before use (fail closed), and writes the
# mod's config from the Docker secret. The secret comes from /run/secrets only, never from an env value or this file, and is never printed.
# GELDAR_NF_* variables are test seams (unset, each is the real value). GELDAR_NF_TELEMETRY=on|off (unset = nothing) drives the ledger and the agent.
set -eu

# NeoForge version from the environment (scratch-neoforge.yml sets it). Only 26.1.2 build N is accepted; the pinned installer sha256
# below refuses any other installer, even if its URL is valid.
if ! printf '%s\n' "${NEOFORGE_VERSION:-}" | grep -Eq '^26\.1\.2\.[0-9]+$'; then
  echo "neoforge-entrypoint: NEOFORGE_VERSION is unset or not 26.1.2 build N; refusing to start" >&2
  exit 1
fi
INSTALLER_URL="${GELDAR_NF_INSTALLER_URL:-https://maven.neoforged.net/releases/net/neoforged/neoforge/${NEOFORGE_VERSION}/neoforge-${NEOFORGE_VERSION}-installer.jar}"
# Proxy Compatible Forge 1.3.1, published 2026-08-31, Modrinth
MOD_URL=${GELDAR_NF_MOD_URL:-https://cdn.modrinth.com/data/vDyrHl8l/versions/qiZ49HIW/proxy-compatible-forge-1.3.1.jar}
MOD_SHA512=${GELDAR_NF_MOD_SHA512:-dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab}
# NeoForge 26.1.2 build 126 installer sha256 (NeoForge Maven). The image reads NEOFORGE_INSTALLER as a local path.
INSTALLER_SHA256=${GELDAR_NF_INSTALLER_SHA256:-1184ffee181bd7a940691539fea07f237096378da4c94795247ecdb9cb354a1b}
# The same installer's sha512 (the Maven's .sha512 file). The installer must match both pins.
INSTALLER_SHA512=${GELDAR_NF_INSTALLER_SHA512:-3ecc1cef40def9af5086449249dc621a860fb3c2af36084635396d152b5617560bfa0ace9376ef9ba05bfc9ab3d92348829472548e57e29a1fab4b63ad621bdb}

data=${GELDAR_NF_DATA_DIR:-/data}
secret_file=${GELDAR_NF_SECRET_FILE:-/run/secrets/velocity-forwarding}
config=${GELDAR_NF_CONFIG:-$data/config/proxy-compatible-forge.toml}
mod=$data/mods/proxy-compatible-forge.jar
installer=$data/neoforge-installer.jar
# The offline bundle's list (written into the bundle as .geldar-bundle.sha256). Present means bundle mode: checked before any fetch.
bundle_list=${GELDAR_NF_BUNDLE_LIST:-$data/.geldar-bundle.sha256}
# The mod jar mounted read-only by compose/opt-in/scratch-neoforge-mod.yml, and its copy in mods/.
mounted_jar=${GELDAR_NF_MOD_JAR:-/geldar/mods/geldar-neoforge.jar}
mod_copy=$data/mods/geldar-neoforge.jar
# The ledger jar (mounted read-only by compose/opt-in/scratch-neoforge-ledger.yml), its copy in mods/, and its properties (copied to
# config/ every start). The agent jar and properties are mounted under /geldar/telemetry and used in place, never copied.
ledger_mounted=${GELDAR_NF_LEDGER_JAR:-/geldar/mods/geldar-neoforge-ledger.jar}
ledger_copy=$data/mods/geldar-neoforge-ledger.jar
ledger_props_mounted=${GELDAR_NF_LEDGER_PROPS:-/geldar/telemetry/ledger.properties}
ledger_props_copy=$data/config/ledger.properties
agent_jar=${GELDAR_NF_OTEL_JAR:-/geldar/telemetry/opentelemetry-javaagent.jar}
agent_props=${GELDAR_NF_OTEL_PROPS:-/geldar/telemetry/otel-agent.properties}
# Optional extra mods: mounted read-only at $extra_dir/<name>.jar, copied to mods/ after the bundle check only when the pin matches
# (see extra_copy). The names are those in compose/neoforge/extra-mods.pins.
extra_dir=${GELDAR_NF_EXTRA_DIR:-/geldar/extra-mods}

# Drop the CR/LF that editors and echo leave behind; nothing else is removed.
secret=$(tr -d '\r\n' < "$secret_file")
if [ -z "$secret" ]; then
  echo "neoforge-entrypoint: $secret_file is empty; regenerate the scratch secrets (down, then up)" >&2
  exit 1
fi
# The value is written unquoted into TOML and sed, so refuse anything outside this set.
case "$secret" in
  *[!a-zA-Z0-9_-]*)
    echo "neoforge-entrypoint: $secret_file holds characters outside [A-Za-z0-9_-]; regenerate the scratch secrets" >&2
    exit 1
    ;;
esac

# Files written below are readable by their owner only.
umask 077

# fetch URL DEST HASH SUM PIN: keeps DEST when it already has HASH (a pre-seeded file with the right hash is used and curl is never called).
# Otherwise downloads (6 retries), checks the hash and moves the file into place; a mismatch deletes the download and exits 1.
fetch() {
  if [ -f "$2" ] && printf '%s  %s\n' "$3" "$2" | "$4" -c --status; then
    return 0
  fi
  rm -f "$2.part"
  if ! curl -fsSL --connect-timeout 60 --max-time 900 --retry 6 --retry-delay 10 --retry-all-errors -o "$2.part" "$1"; then
    rm -f "$2.part"
    echo "neoforge-entrypoint: download of $2 failed after retries. To pre-seed it, put a file at $2 (inside the container) whose $4 matches the pin $5 in compose/neoforge/neoforge-entrypoint.sh, then start again. See docs/runbooks/scratch-stack.md." >&2
    exit 1
  fi
  if ! printf '%s  %s\n' "$3" "$2.part" | "$4" -c --status; then
    rm -f "$2.part" "$2"
    echo "neoforge-entrypoint: $2 does not match its pinned $4 hash; deleted it" >&2
    exit 1
  fi
  mv -f "$2.part" "$2"
}

# extra_prep NAME ENABLED_PIN PIN: removes mods/NAME.jar before the bundle check. A symlink or directory there is refused. Enabled: the stale
# copy goes and extra_copy re-copies the verified jar. Off: the copy is removed only when its sha256 is PIN (our own copy); any other file is refused.
extra_prep() {
  extra_copy_path=$data/mods/$1.jar
  if [ -L "$extra_copy_path" ] || [ -d "$extra_copy_path" ]; then
    echo "neoforge-entrypoint: mods/$1.jar is a symlink or a directory; remove it; refusing to start" >&2
    exit 1
  fi
  if [ -z "$2" ] && [ -e "$extra_copy_path" ]; then
    extra_actual=""
    if [ -f "$extra_copy_path" ]; then
      extra_actual=$(sha256sum "$extra_copy_path" 2>/dev/null || true)
      extra_actual=${extra_actual%% *}
    fi
    if [ -z "$extra_actual" ] || [ "$extra_actual" != "$3" ]; then
      echo "neoforge-entrypoint: mods/$1.jar is not the pinned jar: refusing to delete it or to start" >&2
      exit 1
    fi
  fi
  rm -f "$extra_copy_path"
}

# A copy left by an earlier start is removed first, but only while a mounted jar is present, so the bundle check sees mods/ as the bundle
# lists it. With no mounted jar nothing is removed: the else branch refuses the start instead.
if [ -e "$mounted_jar" ] || [ -L "$mounted_jar" ]; then
  rm -f "$mod_copy"
else
  # No mounted jar: a leftover jar in mods/ or a hash pin with no jar is refused here. A foreign jar beside a mounted one is refused in bundle mode.
  if [ -e "$mod_copy" ] || [ -L "$mod_copy" ]; then
    echo "neoforge-entrypoint: a geldar mod jar is present in mods/ but none is mounted; remove it or mount the pinned jar; refusing to start" >&2
    exit 1
  fi
  if [ -n "${GELDAR_NF_MOD_SHA256:-}" ]; then
    echo "neoforge-entrypoint: GELDAR_NF_MOD_SHA256 is set but no mod jar is mounted; refusing to start" >&2
    exit 1
  fi
fi

# The ledger jar follows GELDAR_NF_TELEMETRY (the case below), with GELDAR_NF_LEDGER_SHA256 as its pin. Our stale copy (exact name, no glob) is
# removed only for on or off; rm -f never follows a link. A directory or other non-file there is refused: it is not ours to remove.
# on: the ledger jar must be mounted; a stale copy is replaced only by a verified copy (copy_pinned_jar), so a mismatch keeps the old copy.
# off: a mounted ledger jar is refused; our stale copy is removed; no agent is added. unset: a mounted jar, a stale copy or a pin with no jar stops the start.
# Any other value stops the start.
ledger_jar_present=0
if [ -e "$ledger_mounted" ] || [ -L "$ledger_mounted" ]; then
  ledger_jar_present=1
fi
case "${GELDAR_NF_TELEMETRY:-}" in
  on)
    if [ "$ledger_jar_present" = 0 ]; then
      echo "neoforge-entrypoint: GELDAR_NF_TELEMETRY=on but no ledger jar is mounted at $ledger_mounted; refusing to start" >&2
      exit 1
    fi
    if [ -d "$ledger_copy" ]; then
      echo "neoforge-entrypoint: the geldar ledger path in mods/ is a directory; remove it; refusing to start" >&2
      exit 1
    fi
    # A stale copy goes before the bundle check only when the mounted jar already matches its pin (a plain hash, not a copy).
    if [ -f "$ledger_mounted" ] && [ ! -L "$ledger_mounted" ]; then
      actual=$(sha256sum "$ledger_mounted" 2>/dev/null || true)
      actual=${actual%% *}
      if [ -n "${GELDAR_NF_LEDGER_SHA256:-}" ] && [ "$actual" = "$GELDAR_NF_LEDGER_SHA256" ]; then
        rm -f "$ledger_copy"
      fi
    fi
    ;;
  off)
    if [ "$ledger_jar_present" = 1 ]; then
      echo "neoforge-entrypoint: GELDAR_NF_TELEMETRY=off but a ledger jar is mounted; remove the mount or set on; refusing to start" >&2
      exit 1
    fi
    if [ -L "$ledger_copy" ] || [ -f "$ledger_copy" ]; then
      rm -f "$ledger_copy"
    elif [ -e "$ledger_copy" ]; then
      echo "neoforge-entrypoint: the geldar ledger path in mods/ is a directory or other non-file; remove it; refusing to start" >&2
      exit 1
    fi
    ;;
  '')
    if [ "$ledger_jar_present" = 1 ]; then
      echo "neoforge-entrypoint: a ledger jar is mounted but GELDAR_NF_TELEMETRY is unset; set GELDAR_NF_TELEMETRY=on or off; refusing to start" >&2
      exit 1
    fi
    if [ -e "$ledger_copy" ] || [ -L "$ledger_copy" ]; then
      echo "neoforge-entrypoint: a geldar ledger jar is present in mods/ but none is mounted; remove it, or set GELDAR_NF_TELEMETRY=off; refusing to start" >&2
      exit 1
    fi
    if [ -n "${GELDAR_NF_LEDGER_SHA256:-}" ]; then
      echo "neoforge-entrypoint: GELDAR_NF_LEDGER_SHA256 is set but no ledger jar is mounted; refusing to start" >&2
      exit 1
    fi
    ;;
  *)
    echo "neoforge-entrypoint: GELDAR_NF_TELEMETRY must be on or off (or unset); refusing to start" >&2
    exit 1
    ;;
esac

# Extra mods: the stale copies go before the bundle check (extra_prep), the pinned jars are copied after it (extra_copy).
extra_prep chunky "${GELDAR_NF_EXTRA_CHUNKY_SHA256:-}" 9f9303da0185fa0ae0e1d3f10a0f07b8d9e5a21e77931d4fc162dcc718a0ab4f
extra_prep bluemap "${GELDAR_NF_EXTRA_BLUEMAP_SHA256:-}" 8938f4453af4b53970c86e43d0bd26b4a88980e4e6639f818fa770d0f61c43df

# Bundle mode, before any fetch. The list holds the bundle's immutable files with their hashes (the start script rewrites other files on every
# start, so they are not listed). Checks, in order: paths (none may leave the data dir), required files, symlinks, strict hashes, then mods/ holds
# exactly the listed jars. Only file names are printed, never contents. unix_args.txt fixes the classpath, so extra files under libraries/ are fine.
if [ -f "$bundle_list" ]; then
  bad=$(awk '$2 ~ /^\// || $2 ~ /^[A-Za-z]:/ || $2 ~ /^-/ || $2 ~ /(^|\/)\.\.(\/|$)/ { print $2; exit }' "$bundle_list")
  if [ -n "$bad" ]; then
    echo "neoforge-entrypoint: offline bundle list names an absolute (/ or drive letter), dash-led or ../ path ($bad); refusing to start" >&2
    exit 1
  fi
  for f in .neoforge-manifest.json neoforge-installer.jar mods/proxy-compatible-forge.jar run.sh; do
    if ! awk -v f="$f" '$2 == f { found = 1 } END { exit !found }' "$bundle_list"; then
      echo "neoforge-entrypoint: offline bundle is incomplete: its list does not name $f; refusing to start" >&2
      exit 1
    fi
  done
  links=$(cd "$data" && find mods libraries -type l 2>/dev/null || true)
  if [ -n "$links" ]; then
    first_link=$(printf '%s\n' "$links" | head -n 1)
    echo "neoforge-entrypoint: offline bundle has symlinks under mods/ or libraries/ (first: $first_link); refusing to start" >&2
    exit 1
  fi
  # --strict: a malformed or truncated line is a failure, not a skipped line.
  if ! (cd "$data" && sha256sum -c --strict --status "$bundle_list"); then
    first=$(cd "$data" && sha256sum -c --strict "$bundle_list" 2>&1 | grep -v ': OK$' | head -n 1 || true)
    echo "neoforge-entrypoint: offline bundle check failed: ${first:-no listed file verified}; refusing to start" >&2
    exit 1
  fi
  listed_mods=$(awk '$2 ~ /^mods\// { print $2 }' "$bundle_list" | LC_ALL=C sort)
  extra=""
  for f in $(cd "$data" && find mods -type f | LC_ALL=C sort); do
    printf '%s\n' "$listed_mods" | grep -qxF -- "$f" || extra="$extra $f"
  done
  if [ -n "$extra" ]; then
    echo "neoforge-entrypoint: mods/ holds files the offline bundle does not list:$extra; refusing to start" >&2
    exit 1
  fi
  export NEOFORGE_FORCE_REINSTALL=false
fi

mkdir -p "$data/mods"
fetch "$MOD_URL" "$mod" "$MOD_SHA512" sha512sum MOD_SHA512
fetch "$INSTALLER_URL" "$installer" "$INSTALLER_SHA256" sha256sum INSTALLER_SHA256
# The installer must also match its sha512 pin; a file that fails it is deleted, so the image never uses it.
if ! printf '%s  %s\n' "$INSTALLER_SHA512" "$installer" | sha512sum -c --status; then
  rm -f "$installer"
  echo "neoforge-entrypoint: $installer does not match its pinned sha512sum hash (INSTALLER_SHA512); deleted it" >&2
  exit 1
fi
# The image installs NeoForge from this local file (start-deployNeoForge reads NEOFORGE_INSTALLER as a path).
export NEOFORGE_INSTALLER="$installer"
chown --reference="$data" "$data/mods" "$mod" "$installer"

# True for exactly 64 lowercase hex digits. The case pattern (not a command substitution) so a newline anywhere is refused.
is_sha256_hex() {
  case "$1" in
    *[!0-9a-f]* | '') return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

# copy_pinned_jar SRC DEST SHA LABEL ENVNAME: copies a mounted jar (the mod or the ledger) into mods/ only when it matches SHA (the value of
# ENVNAME, the pin scratch.sh also checks). Refused: a symlink or non-file, a hash that is not 64 lowercase hex, a mismatch. Nothing is copied on a refusal.
# The copy is .part, mode 644, the data dir's owner, re-hashed, then renamed. Only file names and fixed messages are printed.
copy_pinned_jar() {
  rm -f "$2.part"
  if [ -L "$1" ] || [ ! -f "$1" ]; then
    echo "neoforge-entrypoint: $1 is a symlink or not a regular file; refusing to start" >&2
    exit 1
  fi
  if ! is_sha256_hex "$3"; then
    echo "neoforge-entrypoint: $5 is not 64 lowercase hex digits; refusing to start with a mounted $4 jar" >&2
    exit 1
  fi
  actual=$(sha256sum "$1" 2>/dev/null || true)
  actual=${actual%% *}
  if [ "$actual" != "$3" ]; then
    echo "neoforge-entrypoint: the mounted $4 jar does not match $5; not copied; refusing to start" >&2
    exit 1
  fi
  # The copy is renamed onto $2 only once its hash matches, so a kill or a full disk never leaves a partial jar under the final name.
  cp "$1" "$2.part"
  chmod 644 "$2.part"
  chown --reference="$data" "$2.part"
  copied=$(sha256sum "$2.part" 2>/dev/null || true)
  if [ "${copied%% *}" != "$3" ]; then
    rm -f "$2.part" "$2"
    echo "neoforge-entrypoint: the copy of the $4 jar in mods/ does not match $5; removed it; refusing to start" >&2
    exit 1
  fi
  mv -f "$2.part" "$2"
}

# copy_ledger_props: the mounted ledger properties are copied to config/ on every start (mode 644, the data dir's owner, via .part). A symlink or non-file source is refused.
copy_ledger_props() {
  if [ -L "$ledger_props_mounted" ] || [ ! -f "$ledger_props_mounted" ]; then
    echo "neoforge-entrypoint: $ledger_props_mounted is a symlink or not a regular file; refusing to start" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$ledger_props_copy")"
  chown --reference="$data" "$(dirname "$ledger_props_copy")"
  rm -f "$ledger_props_copy.part"
  cp "$ledger_props_mounted" "$ledger_props_copy.part"
  chmod 644 "$ledger_props_copy.part"
  chown --reference="$data" "$ledger_props_copy.part"
  mv -f "$ledger_props_copy.part" "$ledger_props_copy"
}

if [ -e "$mounted_jar" ] || [ -L "$mounted_jar" ]; then
  copy_pinned_jar "$mounted_jar" "$mod_copy" "${GELDAR_NF_MOD_SHA256:-}" mod GELDAR_NF_MOD_SHA256
fi
if [ "${GELDAR_NF_TELEMETRY:-}" = on ]; then
  copy_pinned_jar "$ledger_mounted" "$ledger_copy" "${GELDAR_NF_LEDGER_SHA256:-}" ledger GELDAR_NF_LEDGER_SHA256
  copy_ledger_props
fi

# extra_copy NAME ENVNAME PIN: copies a mounted extra jar to mods/NAME.jar only when the overlay pins it (copy_pinned_jar checks the hash).
# A mounted jar with no pin, or a pin with no mounted jar, refuses the start. Nothing is copied on a refusal.
extra_copy() {
  extra_mounted="$extra_dir/$1.jar"
  if [ -e "$extra_mounted" ] || [ -L "$extra_mounted" ]; then
    if [ -z "$3" ]; then
      echo "neoforge-entrypoint: $extra_mounted is mounted but $2 is unset; refusing to start" >&2
      exit 1
    fi
    copy_pinned_jar "$extra_mounted" "$data/mods/$1.jar" "$3" "$1" "$2"
  elif [ -n "$3" ]; then
    echo "neoforge-entrypoint: $2 is set but no $1 jar is mounted at $extra_mounted; refusing to start" >&2
    exit 1
  fi
}
extra_copy chunky GELDAR_NF_EXTRA_CHUNKY_SHA256 "${GELDAR_NF_EXTRA_CHUNKY_SHA256:-}"
extra_copy bluemap GELDAR_NF_EXTRA_BLUEMAP_SHA256 "${GELDAR_NF_EXTRA_BLUEMAP_SHA256:-}"

# BlueMap's config bundle is installed by a loader beside it, mounted read-only (compose/neoforge/extra-mods-bluemap-config.sh).
# Only when the BlueMap jar is mounted (extra_copy has checked its pin): the loader must be present and match the sha256 the overlay
# pins before it is sourced. BlueMap reads config/bluemap relative to the working directory, so the java process runs in $data.
if [ -e "$extra_dir/bluemap.jar" ] || [ -L "$extra_dir/bluemap.jar" ]; then
  bm_loader=$extra_dir/bluemap-config.sh
  printf '%s\n' "${GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256:-}" | grep -Eq '^[0-9a-f]{64}$' || { echo "neoforge-entrypoint: GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256 is not a sha256; refusing to start" >&2; exit 1; }
  [ -f "$bm_loader" ] && [ ! -L "$bm_loader" ] && [ -r "$bm_loader" ] || { echo "neoforge-entrypoint: the BlueMap loader is missing, a link or unreadable; refusing to start" >&2; exit 1; }
  [ "$(sha256sum "$bm_loader" | awk '{print $1}')" = "${GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256:-}" ] || { echo "neoforge-entrypoint: the BlueMap loader does not match its pin; refusing to start" >&2; exit 1; }
  . "$bm_loader"
  geldar_bluemap_install_config "$extra_dir/bluemap-config" "$data" || { echo "neoforge-entrypoint: the BlueMap config install refused; refusing to start" >&2; exit 1; }
  cd "$data" || { echo "neoforge-entrypoint: cannot change to $data; refusing to start" >&2; exit 1; }
fi

# The mod's config, from its README layout, is written once. On later starts only the secret line is replaced, because the mod may have rewritten it.
cfgdir=$(dirname "$config")
# A symlink (dangling too) or directory at the config or a backup path is refused before any write, so no write follows a link.
for p in "$config" "$config.bak" "$config.bak.prev" "$config.part"; do
  if [ -L "$p" ] || [ -d "$p" ]; then
    echo "neoforge-entrypoint: $p is a symlink or a directory; refusing to start" >&2
    exit 1
  fi
done
# A TOML form the rewrite below does not handle is refused before any write (quoted [forwarding] header, dotted or quoted forwarding key,
# inline forwarding table). A UTF-8 BOM on line 1 is ignored, as in the rewrite. No value is printed.
if [ -f "$config" ] && LC_ALL=C awk '
  NR == 1 { sub(/^\357\273\277/, "") }
  /^[ \t]*\[[ \t]*[\042\047][ \t]*forwarding[ \t]*[\042\047]/ { bad = 1 }
  /^[ \t]*[\042\047]?forwarding[\042\047]?[ \t]*[.=]/ { bad = 1 }
  END { exit !bad }
' "$config"; then
  echo "neoforge-entrypoint: the PCF config uses a TOML form the entrypoint does not rewrite (a quoted [forwarding] header, a dotted or quoted forwarding key, or an inline forwarding table); delete it or fix it by hand; refusing to start" >&2
  exit 1
fi
mkdir -p "$cfgdir"
if [ ! -e "$config" ]; then
  {
    echo '[forwarding]'
    echo 'enabled = true'
    echo 'mode = "MODERN"'
    printf 'secret = "%s"\n' "$secret"
    echo 'approvedProxyHosts = []'
    echo
    echo '[crossStitch]'
    echo 'enabled = true'
    echo
    echo '[advanced]'
    echo 'modernForwardingVersion = "NO_OVERRIDE"'
  } > "$config"
  chown --reference="$data" "$cfgdir" "$config"
else
  # The mod may have rewritten this file after the first start, so the entrypoint owns it at every start. $config.bak is the first original,
  # written once and never replaced; $config.bak.prev is the file this start found, rewritten each start. Both are mode 600, the data dir's owner.
  # Only enabled, mode and secret under [forwarding] are rewritten, by a section-aware awk (a missing key is inserted). The secret reaches awk
  # in its environment, never on a command line.
  rm -f "$config.part"
  if [ ! -e "$config.bak" ]; then
    cp "$config" "$config.bak"
    chmod 600 "$config.bak"
    chown --reference="$data" "$config.bak"
  fi
  rm -f "$config.bak.prev"
  cp "$config" "$config.bak.prev"
  chmod 600 "$config.bak.prev"
  chown --reference="$data" "$config.bak.prev"
  NF_PCF_SECRET="$secret" LC_ALL=C awk '
    NR == 1 { sub(/^\357\273\277/, "") }
    function table_name(line,   name) {
      name = line
      sub(/^[ \t]*\[/, "", name)
      sub(/\].*$/, "", name)
      gsub(/[ \t]/, "", name)
      return name
    }
    function emit_missing(   i, k) {
      for (i = 1; i <= 3; i++) {
        k = order[i]
        if (!(k in seen)) print val[k]
      }
      in_fwd = 0
    }
    BEGIN {
      order[1] = "enabled"; order[2] = "mode"; order[3] = "secret"
      val["enabled"] = "enabled = true"
      val["mode"] = "mode = \"MODERN\""
      val["secret"] = "secret = \"" ENVIRON["NF_PCF_SECRET"] "\""
    }
    /^[ \t]*\[/ {
      if (in_fwd) emit_missing()
      in_fwd = (table_name($0) == "forwarding")
      if (in_fwd) { fwd_seen = 1; split("", seen) }
      print
      next
    }
    in_fwd && /^[ \t]*(enabled|mode|secret)[ \t]*=/ {
      key = $0
      sub(/^[ \t]*/, "", key)
      sub(/[ \t]*=.*$/, "", key)
      print val[key]
      seen[key] = 1
      next
    }
    { print }
    END {
      if (in_fwd) emit_missing()
      else if (!fwd_seen) { print ""; print "[forwarding]"; in_fwd = 1; emit_missing() }
    }
  ' "$config" > "$config.part"
  chmod 600 "$config.part"
  chown --reference="$data" "$config.part"
  mv -f "$config.part" "$config"
fi
chmod 600 "$config"

# The rewrite above writes exact lines, so this should always pass; it guards against a failed rewrite. The secret is passed in the environment, never printed.
if ! NF_PCF_SECRET="$secret" awk '
  /^[ \t]*\[/ { inforwarding = ($0 ~ /^[ \t]*\[[ \t]*forwarding[ \t]*\]/) }
  inforwarding && $0 == "enabled = true" { enabled = 1 }
  inforwarding && $0 == "mode = \"MODERN\"" { mode = 1 }
  inforwarding && $0 == "secret = \"" ENVIRON["NF_PCF_SECRET"] "\"" { found = 1 }
  END { exit !(enabled && mode && found) }
' "$config"; then
  echo "neoforge-entrypoint: $config does not hold MODERN forwarding with the current secret after the rewrite; refusing to start" >&2
  exit 1
fi

# The OpenTelemetry Java agent, only with GELDAR_NF_TELEMETRY=on. It goes in JVM_OPTS, never JAVA_AGENTS (on the pinned image JAVA_AGENTS goes
# through addAgents and mc-image-helper mcopy). JVM_OPTS reaches user_jvm_args.txt on every NeoForge start (start-finalExec, lines 634-635 of the
# pinned start script). The agent ATTACH is UNVERIFIED until a scratch run shows it in ps or the logs; whether run.sh reads user_jvm_args.txt for
# NeoForge (start-deployNeoForge) is not confirmed. The jar is mounted read-only, never copied, and must match GELDAR_NF_OTEL_AGENT_SHA256 (a repo
# constant set in the overlay). Both files must be present. Only fixed messages are printed, never either file's contents.
case "${GELDAR_NF_TELEMETRY:-}" in
  off)
    # Off adds no agent and makes the shared script's own agent and OTel SDK settings inert.
    unset JAVA_AGENTS OTEL_JAVAAGENT_CONFIGURATION_FILE
    OTEL_SDK_DISABLED=true
    export OTEL_SDK_DISABLED
    ;;
  on)
    case "$agent_jar$agent_props" in
      *[[:space:]]*)
        echo "neoforge-entrypoint: the OpenTelemetry agent paths must not contain whitespace (JVM_OPTS splits on it); refusing to start" >&2
        exit 1
        ;;
    esac
    if [ -L "$agent_jar" ] || [ ! -f "$agent_jar" ]; then
      echo "neoforge-entrypoint: $agent_jar is missing, a symlink or not a regular file; refusing to start" >&2
      exit 1
    fi
    if [ -L "$agent_props" ] || [ ! -f "$agent_props" ]; then
      echo "neoforge-entrypoint: $agent_props is missing, a symlink or not a regular file; refusing to start" >&2
      exit 1
    fi
    agent_sha=${GELDAR_NF_OTEL_AGENT_SHA256:-}
    if ! is_sha256_hex "$agent_sha"; then
      echo "neoforge-entrypoint: GELDAR_NF_OTEL_AGENT_SHA256 is not 64 lowercase hex digits; refusing to start with the OpenTelemetry agent" >&2
      exit 1
    fi
    actual=$(sha256sum "$agent_jar" 2>/dev/null || true)
    actual=${actual%% *}
    if [ "$actual" != "$agent_sha" ]; then
      echo "neoforge-entrypoint: the OpenTelemetry agent jar does not match GELDAR_NF_OTEL_AGENT_SHA256; refusing to start" >&2
      exit 1
    fi
    JVM_OPTS="${JVM_OPTS:-} -javaagent:$agent_jar -Dotel.javaagent.configuration-file=$agent_props"
    export JVM_OPTS
    ;;
  *) ;;
esac

exec "${GELDAR_NF_START:-/image/scripts/start}" "$@"

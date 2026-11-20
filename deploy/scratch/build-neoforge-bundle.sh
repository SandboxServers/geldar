#!/bin/sh
# Builds the offline NeoForge bundle for the scratch nf variant (docs/runbooks/scratch-stack.md, "Offline bundle"). Run it on a
# trusted machine with network and docker: sh deploy/scratch/build-neoforge-bundle.sh <output-dir>.
# Do not run it with sh -x: the trace would print the forwarding secret. The script turns tracing off (set +x) for its own run.
# It runs the image pinned in compose/phase0.yml with the real entrypoint and itzg's SETUP_ONLY=TRUE, which installs NeoForge and
# stops before the server starts. Then it packs an allow-list of immutable install files only: the manifest, the installer, the
# run scripts, libraries/ and mods/. server.properties, user_jvm_args.txt, .run-neoforge.env, config/, world, logs and the rest stay
# out: itzg rewrites some of them on every start, and the others hold secrets or per-run state.
# Seams for the tests: GELDAR_NF_PHASE0, GELDAR_NF_OVERLAY and GELDAR_NF_ENTRYPOINT name the input files, and
# GELDAR_NF_ALLOW_OTHER_BUILD lets a test use a build other than the default (the pinned installer matches only the default).
set -eu
set +x

root=$(cd "$(dirname "$0")/../.." && pwd)
phase0=${GELDAR_NF_PHASE0:-$root/compose/phase0.yml}
overlay=${GELDAR_NF_OVERLAY:-$root/compose/opt-in/scratch-neoforge.yml}
entry=${GELDAR_NF_ENTRYPOINT:-$root/compose/neoforge/neoforge-entrypoint.sh}
# The Minecraft line of the NeoForge build (26.1.2 (build N)). The overlay builds NEOFORGE_VERSION from the same line.
mc_version=26.1.2

usage() {
  echo "usage: sh deploy/scratch/build-neoforge-bundle.sh [--tar <file> --out-sums <file>] <output-dir>" >&2
  exit 2
}
# --tar and --out-sums: the bundle goes to one uncompressed tar with fixed metadata, and its sha256 and sha512 lines go to the sums
# file, instead of the default .tar.gz and bundle.sha256 in <output-dir>. The install and the checks run as before.
tar_file=""
sums_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tar) [ -n "${2:-}" ] || usage; tar_file=$2; shift 2 ;;
    --out-sums) [ -n "${2:-}" ] || usage; sums_file=$2; shift 2 ;;
    --*) usage ;;
    *) break ;;
  esac
done
if [ $# -ne 1 ] || [ -z "$1" ]; then usage; fi
if { [ -n "$tar_file" ] && [ -z "$sums_file" ]; } || { [ -z "$tar_file" ] && [ -n "$sums_file" ]; }; then
  echo "build-neoforge-bundle: --tar and --out-sums go together; give both" >&2
  exit 2
fi
out=$1
command -v docker >/dev/null || { echo "build-neoforge-bundle: docker is not on PATH" >&2; exit 1; }

# The image: the paper service's image line in phase0.yml. It must be pinned by digest.
image=$(tr -d '\r' < "$phase0" | awk '/^  paper:/ { p = 1; next } /^  [a-zA-Z]/ { p = 0 } p && /^    image:/ { print $2; exit }')
if ! printf '%s\n' "$image" | grep -Eq '^itzg/minecraft-server:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$'; then
  echo "build-neoforge-bundle: the paper image in $phase0 is missing or not pinned by digest; refusing" >&2
  exit 1
fi

# The NeoForge build: SCRATCH_NEOFORGE_BUILD if set, else the default the overlay uses. The installer sha256 pinned in the
# entrypoint matches only the default build, so any other build would fail its install: refused unless a test allows it.
default_build=$(sed -n 's/.*SCRATCH_NEOFORGE_BUILD:-\([0-9][0-9]*\)}.*/\1/p' "$overlay" | head -n 1)
build=${SCRATCH_NEOFORGE_BUILD:-$default_build}
if ! printf '%s\n' "$build" | grep -Eq '^[0-9]+$'; then
  echo "build-neoforge-bundle: no NeoForge build in $overlay (SCRATCH_NEOFORGE_BUILD unset); refusing" >&2
  exit 1
fi
if [ "$build" != "$default_build" ] && [ -z "${GELDAR_NF_ALLOW_OTHER_BUILD:-}" ]; then
  echo "build-neoforge-bundle: SCRATCH_NEOFORGE_BUILD=$build is not the default build $default_build; the installer pin in the entrypoint matches only the default, so the install would fail; refusing" >&2
  exit 1
fi
neoforge="$mc_version.$build"

if [ -e "$out" ] && { [ ! -d "$out" ] || [ -n "$(ls -A "$out")" ]; }; then
  echo "build-neoforge-bundle: $out exists and is not an empty directory; refusing to write into it" >&2
  if [ -d "$out" ] && ls -A "$out" | grep -q '^\.work\.'; then
    echo "build-neoforge-bundle: $out holds a .work.* directory left by an earlier failed build; it may hold root-owned install files (Linux), so remove it (sudo if needed) and rerun" >&2
  fi
  exit 1
fi
mkdir -p "$out"
# Absolute before any mount path is built: docker needs an absolute bind source. pwd -W gives the Windows form on Git Bash.
out=$(cd "$out" && { pwd -W 2>/dev/null || pwd; })
work=$(mktemp -d "$out/.work.XXXXXX")
data="$work/data"
mkdir -p "$data"

# Restores the owner of the data dir on Linux, where the install container ran as root, using the same pinned image (chown only).
# cleanup runs on every exit, so a failed install gets it too; then the work dir is removed.
give_back() {
  [ -d "$data" ] && [ "$(uname -s)" = Linux ] || return 0
  MSYS_NO_PATHCONV=1 docker run --rm --user 0 -v "$data:/data" --entrypoint /bin/sh "$image" \
    -c 'chown -R "$1" /data' sh "$(id -u):$(id -g)" >/dev/null 2>&1 ||
    echo "build-neoforge-bundle: could not reset the owner of $data; sudo is needed to remove it" >&2
}
cleanup() {
  rc=$?
  give_back
  rm -rf "$work" 2>/dev/null || echo "build-neoforge-bundle: could not remove $work; remove it by hand (sudo on Linux) before a rerun" >&2
  exit "$rc"
}
trap cleanup EXIT

# A throwaway secret: 32 characters of [A-Za-z0-9_-], written mode 600 into the work dir. It is never printed.
secret=""
while [ "${#secret}" -lt 32 ]; do
  secret="$secret$(head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9_-')"
done
(umask 077 && printf '%s\n' "$(printf '%s' "$secret" | cut -c 1-32)" > "$work/velocity-forwarding")
chmod 600 "$work/velocity-forwarding"
secret=$(tr -d '\r\n' < "$work/velocity-forwarding")

# The install. MSYS_NO_PATHCONV stops Git Bash from rewriting the container paths. Exactly three mounts: the data dir, the
# entrypoint (read-only) and the secret (read-only). No other mount, and no docker socket.
MSYS_NO_PATHCONV=1 docker run --rm \
  -e EULA=TRUE -e TYPE=NEOFORGE -e VERSION="$mc_version" -e NEOFORGE_VERSION="$neoforge" \
  -e SETUP_ONLY=TRUE -e ONLINE_MODE=FALSE -e MEMORY=1G \
  -v "$data:/data" \
  -v "$entry:/geldar/neoforge-entrypoint.sh:ro" \
  -v "$work/velocity-forwarding:/run/secrets/velocity-forwarding:ro" \
  --entrypoint /bin/sh "$image" /geldar/neoforge-entrypoint.sh

for f in .neoforge-manifest.json neoforge-installer.jar mods/proxy-compatible-forge.jar; do
  [ -f "$data/$f" ] || { echo "build-neoforge-bundle: $f is missing after the install; refusing to bundle" >&2; exit 1; }
done
server_entry=$(sed -n 's/.*"serverEntry" *: *"\([^"]*\)".*/\1/p' "$data/.neoforge-manifest.json" | head -n 1)
case "$server_entry" in
  ''|/*|*..*) echo "build-neoforge-bundle: the manifest names no usable serverEntry; refusing to bundle" >&2; exit 1 ;;
esac
[ -f "$data/$server_entry" ] || { echo "build-neoforge-bundle: serverEntry $server_entry is missing; refusing to bundle" >&2; exit 1; }

# The secret may sit only in config/. Any other file in /data that holds it aborts the build; the names are printed, not the secret.
leaks=$(grep -rlF -- "$secret" "$data" | grep -v "^$data/config/" | sed "s|^$data/||" || true)
if [ -n "$leaks" ]; then
  echo "build-neoforge-bundle: the forwarding secret appears outside config/ in these files; refusing to bundle:" >&2
  printf '%s\n' "$leaks" >&2
  exit 1
fi

# The allow-list: only these top-level names are packed, and only regular files under them. Names that the install did not
# create are skipped. A symlink under them aborts the build.
present=""
for n in .neoforge-manifest.json neoforge-installer.jar run.sh run.bat libraries mods; do
  if [ -e "$data/$n" ]; then present="$present $n"; fi
done
[ -n "$present" ] || { echo "build-neoforge-bundle: the install left no files to bundle; refusing" >&2; exit 1; }
links=$(cd "$data" && find $present -type l)
if [ -n "$links" ]; then
  echo "build-neoforge-bundle: symlinks in the install; refusing to bundle:" >&2
  printf '%s\n' "$links" >&2
  exit 1
fi
(cd "$data" && find $present -type f | sed 's|^\./||' | LC_ALL=C sort) > "$work/files.txt"
[ -s "$work/files.txt" ] || { echo "build-neoforge-bundle: no files to bundle; refusing" >&2; exit 1; }

# The rcon password is random per build. It is read here, never printed, and must not be in any packed file.
rcon=$(sed -n 's/^rcon\.password=//p' "$data/server.properties" 2>/dev/null | head -n 1 | tr -d '\r' || true)
if [ -n "$rcon" ]; then
  rleaks=$(cd "$data" && while IFS= read -r f; do if grep -qF -- "$rcon" "$f"; then echo "$f"; fi; done < "$work/files.txt")
  if [ -n "$rleaks" ]; then
    echo "build-neoforge-bundle: the rcon password appears in these packed files; refusing to bundle:" >&2
    printf '%s\n' "$rleaks" >&2
    exit 1
  fi
fi

# write_bundle_tar DIR LIST TAR SUMS: packs the names in LIST (paths relative to DIR, in any order) into the uncompressed tar TAR,
# sorted by name, with mtime 0, numeric owner 0:0 and no user names. SUMS gets two lines, the sha256 and the sha512 of TAR, each
# named with TAR's base name. It runs no docker, so a test can call it on a fixture directory. It needs GNU tar (--mtime).
write_bundle_tar() {
  wt_dir=$1; wt_list=$2; wt_tar=$3; wt_sums=$4
  tar --version 2>/dev/null | head -n 1 | grep -q '^tar (GNU tar)' ||
    { echo "build-neoforge-bundle: tar mode needs GNU tar (--mtime); refusing" >&2; return 1; }
  wt_vflag=""
  if tar --help 2>/dev/null | grep -q -- --verbatim-files-from; then wt_vflag=--verbatim-files-from; fi
  # The archive goes to stdout, as in the default path: GNU tar reads a Windows drive letter in -f (C:/...) as a host name.
  # --mode=go-w,u+rw sets the stored modes: group and other lose write, the owner gains read and write, and the exec bit stays.
  # So a umask of 022 or 002 gives the same bytes. A failed tar removes the partial archive, so no half-written tar is left.
  LC_ALL=C sort "$wt_list" | tar $wt_vflag --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=go-w,u+rw -cf - -C "$wt_dir" -T - > "$wt_tar" ||
    { rm -f "$wt_tar"; echo "build-neoforge-bundle: tar failed; removed the partial $wt_tar" >&2; return 1; }
  wt_name=$(basename -- "$wt_tar")
  wt_256=$(sha256sum < "$wt_tar" | awk '{ print $1 }')
  wt_512=$(sha512sum < "$wt_tar" | awk '{ print $1 }')
  printf '%s  %s\n%s  %s\n' "$wt_256" "$wt_name" "$wt_512" "$wt_name" > "$wt_sums"
}

# The marker lists each packed file with its sha256 and is itself in the tar, not in its own list. Git's sha256sum writes
# "hash *name" (binary mode); the sed writes the text form, "hash  name", on every platform.
(cd "$data" && while IFS= read -r f; do sha256sum -- "$f"; done < "$work/files.txt") |
  sed 's/^\([0-9a-f]\{64\}\) [* ]/\1  /' > "$work/hashes.txt"
cp "$work/hashes.txt" "$data/.geldar-bundle.sha256"
{ cat "$work/files.txt"; echo .geldar-bundle.sha256; } > "$work/tar-list.txt"

if [ -n "$tar_file" ]; then
  write_bundle_tar "$data" "$work/tar-list.txt" "$tar_file" "$sums_file"
  echo "bundle: $tar_file"
  echo "size: $(wc -c < "$tar_file" | tr -d ' ') bytes"
  echo "files: $(wc -l < "$work/hashes.txt" | tr -d ' ')"
  echo "sums: $sums_file"
  exit 0
fi

tgz_name="neoforge-$mc_version-build$build-bundle.tar.gz"
# --verbatim-files-from (GNU tar) takes the list's names literally, so a name that starts with "-" is not an option. Other tars
# do without it.
vflag=""
if tar --help 2>/dev/null | grep -q -- --verbatim-files-from; then vflag=--verbatim-files-from; fi
# The archive goes to stdout: GNU tar reads a Windows drive letter in -f (C:/...) as a host name.
tar $vflag --owner=0 --group=0 --numeric-owner -czf - -C "$data" -T "$work/tar-list.txt" > "$out/$tgz_name"
(cd "$out" && sha256sum -- "$tgz_name") > "$out/bundle.sha256"

echo "bundle: $out/$tgz_name"
echo "size: $(wc -c < "$out/$tgz_name" | tr -d ' ') bytes"
echo "files: $(wc -l < "$work/hashes.txt" | tr -d ' ')"
echo "bundle sha256: $(awk '{ print $1 }' "$out/bundle.sha256")"
echo "compare the bundle sha256 with a copy that comes by another channel than the tarball; a hash that travels with the tarball only guards corruption"

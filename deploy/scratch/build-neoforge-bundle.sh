#!/bin/sh
# Builds the offline NeoForge bundle for the scratch nf variant (docs/runbooks/scratch-stack.md, "Offline bundle"). Run it on a
# trusted machine with network and docker: sh deploy/scratch/build-neoforge-bundle.sh <output-dir>.
# It runs the image pinned in compose/phase0.yml with the real entrypoint and itzg's SETUP_ONLY=TRUE, which installs NeoForge and
# stops before the server starts. Then it packs /data without config/ (it holds the forwarding secret), world, logs and the other
# per-run files. The installer never runs outside the container, and the only network use is docker pulling the image.
# Seams for the tests: GELDAR_NF_PHASE0, GELDAR_NF_OVERLAY and GELDAR_NF_ENTRYPOINT name the input files.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
phase0=${GELDAR_NF_PHASE0:-$root/compose/phase0.yml}
overlay=${GELDAR_NF_OVERLAY:-$root/compose/opt-in/scratch-neoforge.yml}
entry=${GELDAR_NF_ENTRYPOINT:-$root/compose/neoforge/neoforge-entrypoint.sh}
# The Minecraft line of the NeoForge build (26.1.2 (build N)). The overlay builds NEOFORGE_VERSION from the same line.
mc_version=26.1.2

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: sh deploy/scratch/build-neoforge-bundle.sh <output-dir>" >&2
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

# The NeoForge build: SCRATCH_NEOFORGE_BUILD if set, else the default the overlay uses. One source, so they agree.
build=$(sed -n 's/.*SCRATCH_NEOFORGE_BUILD:-\([0-9][0-9]*\)}.*/\1/p' "$overlay" | head -n 1)
build=${SCRATCH_NEOFORGE_BUILD:-$build}
if ! printf '%s\n' "$build" | grep -Eq '^[0-9]+$'; then
  echo "build-neoforge-bundle: no NeoForge build in $overlay (SCRATCH_NEOFORGE_BUILD unset); refusing" >&2
  exit 1
fi
neoforge="$mc_version.$build"

if [ -e "$out" ] && { [ ! -d "$out" ] || [ -n "$(ls -A "$out")" ]; }; then
  echo "build-neoforge-bundle: $out exists and is not an empty directory; refusing to write into it" >&2
  exit 1
fi
mkdir -p "$out"
work=$(mktemp -d "$out/.work.XXXXXX")
trap 'rm -rf "$work" 2>/dev/null || true' EXIT
data="$work/data"
mkdir -p "$data"

# A throwaway secret: 32 characters of [A-Za-z0-9_-], written mode 600 into the work dir. It is never printed.
secret=""
while [ "${#secret}" -lt 32 ]; do
  secret="$secret$(head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9_-')"
done
(umask 077 && printf '%s\n' "$(printf '%s' "$secret" | cut -c 1-32)" > "$work/velocity-forwarding")
chmod 600 "$work/velocity-forwarding"
secret=$(tr -d '\r\n' < "$work/velocity-forwarding")

# The install. MSYS_NO_PATHCONV stops Git Bash from rewriting the container paths.
MSYS_NO_PATHCONV=1 docker run --rm \
  -e EULA=TRUE -e TYPE=NEOFORGE -e VERSION="$mc_version" -e NEOFORGE_VERSION="$neoforge" \
  -e SETUP_ONLY=TRUE -e ONLINE_MODE=FALSE -e MEMORY=1G \
  -v "$data:/data" \
  -v "$entry:/geldar/neoforge-entrypoint.sh:ro" \
  -v "$work/velocity-forwarding:/run/secrets/velocity-forwarding:ro" \
  --entrypoint /bin/sh "$image" /geldar/neoforge-entrypoint.sh
# The container wrote /data as root: hand it back to this user so the work dir can be removed.
MSYS_NO_PATHCONV=1 docker run --rm --user 0 -v "$data:/data" --entrypoint /bin/sh "$image" \
  -c 'chown -R "$1" /data' sh "$(id -u):$(id -g)"

for f in .neoforge-manifest.json neoforge-installer.jar mods/proxy-compatible-forge.jar; do
  [ -f "$data/$f" ] || { echo "build-neoforge-bundle: $f is missing after the install; refusing to bundle" >&2; exit 1; }
done
server_entry=$(sed -n 's/.*"serverEntry" *: *"\([^"]*\)".*/\1/p' "$data/.neoforge-manifest.json" | head -n 1)
case "$server_entry" in
  ''|/*|*..*) echo "build-neoforge-bundle: the manifest names no usable serverEntry; refusing to bundle" >&2; exit 1 ;;
esac
[ -f "$data/$server_entry" ] || { echo "build-neoforge-bundle: serverEntry $server_entry is missing; refusing to bundle" >&2; exit 1; }

# The secret may sit only in config/. Any other file that holds it aborts the build; the names are printed, the secret is not.
leaks=$(grep -rlF -- "$secret" "$data" | grep -v "^$data/config/" | sed "s|^$data/||" || true)
if [ -n "$leaks" ]; then
  echo "build-neoforge-bundle: the forwarding secret appears outside config/ in these files; refusing to bundle:" >&2
  printf '%s\n' "$leaks" >&2
  exit 1
fi

# The bundle's files: everything but the excluded paths, sorted. The marker lists them with their hashes; the marker is in the tar
# and is not in its own list.
(cd "$data" && find . -type f ! -path './config/*' ! -path './world*' ! -path './logs/*' ! -path './crash-reports/*' \
  ! -name eula.txt ! -name usercache.json ! -name '.rcon-cli.*' | sed 's|^\./||' | LC_ALL=C sort) > "$work/files.txt"
[ -s "$work/files.txt" ] || { echo "build-neoforge-bundle: no files to bundle; refusing" >&2; exit 1; }
# Git's sha256sum writes "hash *name" (binary mode); the sed writes the text form, "hash  name", on every platform.
(cd "$data" && while IFS= read -r f; do sha256sum -- "$f"; done < "$work/files.txt") |
  sed 's/^\([0-9a-f]\{64\}\) [* ]/\1  /' > "$work/hashes.txt"
cp "$work/hashes.txt" "$data/.geldar-bundle.sha256"
cp "$work/hashes.txt" "$out/bundle-files.sha256"
{ cat "$work/files.txt"; echo .geldar-bundle.sha256; } > "$work/tar-list.txt"

tgz_name="neoforge-$mc_version-build$build-bundle.tar.gz"
# The archive goes to stdout: GNU tar reads a Windows drive letter in -f (C:/...) as a host name.
tar --owner=0 --group=0 --numeric-owner -czf - -C "$data" -T "$work/tar-list.txt" > "$out/$tgz_name"
(cd "$out" && sha256sum -- "$tgz_name") > "$out/bundle.sha256"

echo "bundle: $out/$tgz_name"
echo "size: $(wc -c < "$out/$tgz_name" | tr -d ' ') bytes"
echo "files: $(wc -l < "$work/hashes.txt" | tr -d ' ')"
echo "bundle sha256: $(awk '{ print $1 }' "$out/bundle.sha256")"
echo "bundle-files sha256: $(sha256sum "$out/bundle-files.sha256" | awk '{ print $1 }')"

#!/bin/sh
# Builds the NeoForge telemetry mod jar (neoforge-ledger/, geldar-neoforge-ledger) on a desktop and writes the jar, its sha256
# and a build-info file into an output dir. Modelled on deploy/scratch/build-neoforge-mod.sh and keeps its rules. It runs the
# pinned Gradle wrapper of neoforge-ledger/, which downloads Gradle and the NeoForge and OpenTelemetry artifacts, so a first run
# needs network. Run it from a clean export of the commit, never from the live checkout:
#   COMMIT=$(git rev-parse origin/main) && git archive --format=tar --prefix=geldar/ -o <absolute-file>.tar "$COMMIT"
#   tar -tf <absolute-file>.tar    # stop if any entry is an absolute path or contains ".."
#   tar -xf <absolute-file>.tar -C <empty-dir>    # the directory must be empty; stop on any failed step
#   cd <empty-dir> && GELDAR_LEDGER_BUILD_COMMIT=$COMMIT GELDAR_LEDGER_BUILD_FROM_EXPORT=1 sh geldar/deploy/build-neoforge-ledger.sh <absolute-output-dir>
# The build reads three trees: neoforge-ledger/ (the mod), plugin/ (ledger-core, a composite build) and neoforge/ (the NeoForge
# and ModDevGradle pins), so the export or checkout must hold all of them. In a git checkout the script refuses unless those
# three have no changes and no untracked files, and records HEAD. An export has no .git: the caller says so with
# GELDAR_LEDGER_BUILD_FROM_EXPORT=1 and names the commit with GELDAR_LEDGER_BUILD_COMMIT (exactly 40 lowercase hex).
#
# Online or offline: the script adds no --offline and no --write-locks. Gradle takes what it has in its cache and downloads the
# rest; every downloaded artifact is checked against neoforge-ledger/gradle/verification-metadata.xml (and the wrapper against
# its distributionSha256Sum), so a download from the network cannot change the jar unnoticed. For a machine with no network, fill
# the Gradle user home (GRADLE_USER_HOME, kept) by one online run, then run again: Gradle then finds everything in the cache.
# Dependency verification stays on: the wrapper gets the single task build. The script clears GRADLE_* (except GRADLE_USER_HOME),
# ORG_GRADLE_PROJECT_*, JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS and _JAVA_OPTIONS before it runs anything, refuses a Gradle user
# home gradle.properties that mentions dependency.verification, and adds no flag that turns verification off. JAVA_HOME is left
# as it is, as in the model: the build uses a Java 25 toolchain that Gradle resolves itself, and the java line is recorded.
#
# After the build the jar must pass these checks, or no output is kept: exactly one jar named geldar-neoforge-ledger-0.1.0.jar;
# META-INF/neoforge.mods.toml with modId "ledger"; exactly four nested jars under META-INF/jarjar/ (ledger-core and the
# OpenTelemetry api, common and context jars) and no jnats; no .java source.
# Final line on stdout: ledger-jar <path> sha256 <hex> commit <sha> bytes <n>. Exit 0 = jar written; 1 = refused or failed; 2 = usage.
# Seam for tests: GELDAR_LEDGER_GRADLE runs that command instead of the wrapper, in neoforge-ledger/, with the single argument
# build. It is refused unless GELDAR_LEDGER_ALLOW_SEAM=1 is set too.
# The script never prints or writes a secret.
set -eu
set +x
# The ambient variables that could weaken the build are cleared first. Only the wrapper's own settings apply after this.
unset GRADLE_OPTS JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS GRADLE_USER_HOME_OPTS
for v in $(env | sed -n 's/^\(GRADLE_[A-Za-z0-9_]*\|ORG_GRADLE_PROJECT_[A-Za-z0-9_]*\)=.*/\1/p'); do
  [ "$v" = GRADLE_USER_HOME ] || unset "$v"
done
if [ -n "${GELDAR_LEDGER_GRADLE:-}" ] && [ "${GELDAR_LEDGER_ALLOW_SEAM:-}" != 1 ]; then
  echo "build-neoforge-ledger: GELDAR_LEDGER_GRADLE is a test seam and needs GELDAR_LEDGER_ALLOW_SEAM=1 as well; refusing" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
nf="$root/neoforge-ledger"
jar_name=geldar-neoforge-ledger-0.1.0.jar

usage() {
  echo "usage: sh deploy/build-neoforge-ledger.sh <absolute-output-dir>" >&2
}

# The output dir: absolute (POSIX or a Windows drive path, which Git Bash also takes), and absent or empty.
check_out() {
  if [ -e "$out" ] && { [ ! -d "$out" ] || [ -n "$(ls -A "$out")" ]; }; then
    echo "build-neoforge-ledger: $out exists and is not an empty directory; refusing to write into it" >&2
    exit 1
  fi
}

if [ $# -ne 1 ] || [ -z "$1" ]; then
  usage
  exit 2
fi
out=$1
case "$out" in
  /* | [A-Za-z]:/* | [A-Za-z]:\\*) ;;
  *)
    echo "build-neoforge-ledger: the output dir must be an absolute path; refusing: $out" >&2
    exit 1
    ;;
esac
check_out

# A user-level Gradle setting that touches dependency verification would weaken the build; refuse it.
user_props="${GRADLE_USER_HOME:-${HOME:-/nonexistent}/.gradle}/gradle.properties"
if [ -f "$user_props" ] && grep -q 'dependency\.verification' "$user_props"; then
  echo "build-neoforge-ledger: $user_props mentions dependency.verification; remove it or use another GRADLE_USER_HOME; refusing" >&2
  exit 1
fi

# The source is clean. With a .git the status of the three trees must be empty; without one the tree must be an export, which
# the caller says with GELDAR_LEDGER_BUILD_FROM_EXPORT=1.
for d in neoforge-ledger plugin neoforge; do
  [ -d "$root/$d" ] || { echo "build-neoforge-ledger: $root/$d is missing; the build needs neoforge-ledger, plugin and neoforge; refusing" >&2; exit 1; }
done
if [ -e "$root/.git" ]; then
  dirty=$(git -C "$root" status --porcelain -- neoforge-ledger plugin neoforge) ||
    { echo "build-neoforge-ledger: git status failed in $root; refusing" >&2; exit 1; }
  if [ -n "$dirty" ]; then
    echo "build-neoforge-ledger: neoforge-ledger/, plugin/ or neoforge/ has changes or untracked files; the jar must come from a clean tree; refusing:" >&2
    printf '%s\n' "$dirty" >&2
    exit 1
  fi
  commit=$(git -C "$root" rev-parse HEAD) || { echo "build-neoforge-ledger: git rev-parse failed; refusing" >&2; exit 1; }
  commit_note=$commit
elif [ "${GELDAR_LEDGER_BUILD_FROM_EXPORT:-}" = 1 ]; then
  # An invalid value is cleared, so the length check refuses it too (a newline inside the value is refused the same way).
  commit_in=${GELDAR_LEDGER_BUILD_COMMIT:-}
  case "$commit_in" in
    *[!0-9a-f]*) commit_in= ;;
  esac
  [ "${#commit_in}" -eq 40 ] ||
    { echo "build-neoforge-ledger: export mode needs GELDAR_LEDGER_BUILD_COMMIT, the 40 lowercase hex commit the export was made from (git rev-parse before git archive); refusing" >&2; exit 1; }
  commit=$commit_in
  commit_note="$commit_in (export)"
else
  echo "build-neoforge-ledger: $root has no .git; build from a git checkout, or from a git archive export with GELDAR_LEDGER_BUILD_FROM_EXPORT=1; refusing" >&2
  exit 1
fi

# The wrapper's Gradle version and its distribution checksum: the pin the wrapper checks before it runs Gradle.
props="$nf/gradle/wrapper/gradle-wrapper.properties"
[ -f "$props" ] || { echo "build-neoforge-ledger: $props is missing; refusing" >&2; exit 1; }
props_text=$(tr -d '\r' < "$props")
wrapper_version=$(printf '%s\n' "$props_text" | sed -n 's|^distributionUrl=.*/gradle-\([0-9][0-9.]*\)-bin\.zip.*|\1|p' | head -n 1)
case "$wrapper_version" in
  '' | *[!0-9.]*) echo "build-neoforge-ledger: no Gradle version in the wrapper properties; refusing" >&2; exit 1 ;;
esac
printf '%s\n' "$props_text" | grep -Eq '^distributionSha256Sum=[0-9a-f]{64}$' ||
  { echo "build-neoforge-ledger: the wrapper has no distributionSha256Sum; refusing" >&2; exit 1; }
[ -f "$nf/gradle/verification-metadata.xml" ] ||
  { echo "build-neoforge-ledger: $nf/gradle/verification-metadata.xml is missing; refusing" >&2; exit 1; }

# The build. Windows (Git Bash) runs gradlew.bat; elsewhere the wrapper runs under sh, so a checkout without the executable
# bit still works. Either way the only argument is build, and the wrapper's own checks stay on.
if [ -n "${GELDAR_LEDGER_GRADLE:-}" ]; then
  (cd "$nf" && "$GELDAR_LEDGER_GRADLE" build) || { echo "build-neoforge-ledger: the build failed; no jar written" >&2; exit 1; }
else
  case $(uname -s) in
    MINGW* | MSYS* | CYGWIN*)
      (cd "$nf" && ./gradlew.bat build) || { echo "build-neoforge-ledger: the build failed; no jar written" >&2; exit 1; }
      ;;
    *)
      (cd "$nf" && sh ./gradlew build) || { echo "build-neoforge-ledger: the build failed; no jar written" >&2; exit 1; }
      ;;
  esac
fi

# Exactly one jar: the one that is neither -sources nor -javadoc, and it has the expected name.
libs="$nf/build/libs"
jars=""
if [ -d "$libs" ]; then
  jars=$(find "$libs" -maxdepth 1 -type f -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar')
fi
count=$(printf '%s\n' "$jars" | grep -c . || true)
case "$count" in
  0)
    echo "build-neoforge-ledger: no jar in $libs after the build; refusing" >&2
    exit 1
    ;;
  1) ;;
  *)
    echo "build-neoforge-ledger: $count jars in $libs; the build must leave exactly one; refusing:" >&2
    printf '%s\n' "$jars" | while IFS= read -r j; do basename "$j"; done >&2
    exit 1
    ;;
esac
jar_path=$jars
[ "$(basename "$jar_path")" = "$jar_name" ] ||
  { echo "build-neoforge-ledger: the build made $(basename "$jar_path"), expected $jar_name; refusing" >&2; exit 1; }

# The jar's entries. jar tf, or unzip -Z1 without a JDK.
if command -v jar >/dev/null 2>&1; then
  listing=$(jar tf "$jar_path") || { echo "build-neoforge-ledger: jar tf could not read the jar; refusing" >&2; exit 1; }
elif command -v unzip >/dev/null 2>&1; then
  listing=$(unzip -Z1 "$jar_path") || { echo "build-neoforge-ledger: unzip could not read the jar; refusing" >&2; exit 1; }
else
  echo "build-neoforge-ledger: neither jar nor unzip is on PATH; cannot check the jar; refusing" >&2
  exit 1
fi
listing=$(printf '%s\n' "$listing" | tr -d '\r')
printf '%s\n' "$listing" | grep -qx 'META-INF/neoforge.mods.toml' ||
  { echo "build-neoforge-ledger: the jar has no META-INF/neoforge.mods.toml; refusing" >&2; exit 1; }
java_count=$(printf '%s\n' "$listing" | grep -c '\.java$' || true)
if [ "$java_count" -ne 0 ]; then
  echo "build-neoforge-ledger: the jar holds $java_count .java source files; the jar must hold only compiled classes; refusing" >&2
  exit 1
fi

# The nested jars: ledger-core and the three OpenTelemetry jars, and nothing else (no jnats: the mod does not talk NATS).
nested=$(printf '%s\n' "$listing" | grep '^META-INF/jarjar/.*\.jar$' || true)
nested_count=$(printf '%s\n' "$nested" | grep -c . || true)
if [ "$nested_count" -ne 4 ]; then
  echo "build-neoforge-ledger: the jar nests $nested_count jars under META-INF/jarjar/, expected 4; refusing:" >&2
  printf '%s\n' "$nested" >&2
  exit 1
fi
for want in 'ledger-core' 'opentelemetry-api' 'opentelemetry-common' 'opentelemetry-context'; do
  # ledger-core is nested as geldar-plugin.ledger-core-0.1.0.jar (the composite build's group prefix), the others as <artifact>-<version>.jar.
  printf '%s\n' "$nested" | grep -Eq "^META-INF/jarjar/([A-Za-z0-9_-]+\.)?$want-[0-9][^/]*\.jar\$" ||
    { echo "build-neoforge-ledger: the jar does not nest $want under META-INF/jarjar/; the server has neither, so the mod would fail at load; refusing" >&2; exit 1; }
done
if printf '%s\n' "$listing" | grep -qi 'jnats'; then
  echo "build-neoforge-ledger: the jar holds a jnats entry; the ledger mod must not carry NATS; refusing" >&2
  exit 1
fi

# The mod descriptor must name the mod id "ledger". Read it with unzip -p, or extract it with jar into a scratch dir.
if command -v unzip >/dev/null 2>&1; then
  toml=$(unzip -p "$jar_path" META-INF/neoforge.mods.toml) || { echo "build-neoforge-ledger: unzip could not read neoforge.mods.toml; refusing" >&2; exit 1; }
else
  tmpd=$(mktemp -d) || { echo "build-neoforge-ledger: mktemp failed; refusing" >&2; exit 1; }
  (cd "$tmpd" && jar xf "$jar_path" META-INF/neoforge.mods.toml) || { rm -rf "$tmpd"; echo "build-neoforge-ledger: jar xf failed; refusing" >&2; exit 1; }
  toml=$(cat "$tmpd/META-INF/neoforge.mods.toml"); rm -rf "$tmpd"
fi
printf '%s\n' "$toml" | tr -d '\r' | grep -Eq '^[[:space:]]*modId[[:space:]]*=[[:space:]]*"ledger"[[:space:]]*(#.*)?$' ||
  { echo "build-neoforge-ledger: neoforge.mods.toml has no modId = \"ledger\"; refusing" >&2; exit 1; }

# The output: copied only now, after every check. The dir is checked again, since the build took a while.
check_out
made_out=
[ -d "$out" ] || made_out=1
mkdir -p "$out"
wrote=1
cleanup() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ -n "${wrote:-}" ]; then
    rm -f "$out/$jar_name" "$out/$jar_name.sha256" "$out/geldar-neoforge-ledger.build-info"
    if [ -n "${made_out:-}" ]; then rmdir "$out" 2>/dev/null || true; fi
  fi
  exit "$rc"
}
trap cleanup EXIT
cp "$jar_path" "$out/$jar_name"
# The hash is taken in its own step: a pipeline would hide a failing sha256sum behind the sed's status.
hashed=$(cd "$out" && sha256sum -- "$jar_name") || { echo "build-neoforge-ledger: sha256sum failed; no output kept" >&2; exit 1; }
# sha256sum on Git Bash writes "hash *name" (binary mode); the sed writes the text form, "hash  name", on every platform.
printf '%s\n' "$hashed" | sed 's/^\([0-9a-f]\{64\}\) [* ]/\1  /' > "$out/$jar_name.sha256"
sha=$(awk '{ print $1 }' "$out/$jar_name.sha256")
size=$(wc -c < "$out/$jar_name" | tr -d ' ')

if command -v java >/dev/null 2>&1; then
  java_line=$(java -version 2>&1 | sed -n '1p' | tr -d '\r')
else
  java_line=unavailable
fi
{
  echo "commit=$commit_note"
  echo "built_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "gradle_wrapper=$wrapper_version"
  echo "java=$java_line"
  echo "jar=$jar_name"
  echo "jar_sha256=$sha"
  echo "jar_bytes=$size"
} > "$out/geldar-neoforge-ledger.build-info"

echo "compare the sha256 with a copy that comes by another channel than the jar; a hash that travels with the jar only guards corruption"
echo "ledger-jar $out/$jar_name sha256 $sha commit $commit bytes $size"

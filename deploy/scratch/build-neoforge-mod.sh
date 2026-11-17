#!/bin/sh
# Builds the NeoForge mod jar (neoforge/, the geldar-neoforge project) on a desktop and writes the jar, its sha256 and a
# build-info file into an output dir (docs/runbooks/scratch-stack.md, "Building the mod jar"). It runs the pinned Gradle wrapper,
# which downloads Gradle and the NeoForge artifacts, so it needs network. Run it from a clean export of main, never from the
# live checkout, as the nats-auth runbook does:
#   COMMIT=$(git rev-parse origin/main) && git archive --format=tar --prefix=geldar/ "$COMMIT" | tar -x -C <empty-dir>
#   GELDAR_MOD_BUILD_COMMIT=$COMMIT GELDAR_MOD_BUILD_FROM_EXPORT=1 sh <empty-dir>/geldar/deploy/scratch/build-neoforge-mod.sh <absolute-output-dir>
# In a git checkout the script refuses unless neoforge/ has no changes and no untracked files, and records HEAD. An export has
# no .git: the caller says so with GELDAR_MOD_BUILD_FROM_EXPORT=1 and names the commit it was made from with
# GELDAR_MOD_BUILD_COMMIT (exactly 40 lowercase hex); build-info records it as "commit=<sha> (export)".
# Dependency verification stays on: the wrapper gets the single task build. The script clears GRADLE_OPTS, JAVA_TOOL_OPTIONS,
# JDK_JAVA_OPTIONS, _JAVA_OPTIONS and GRADLE_USER_HOME_OPTS before it runs anything, and adds no flag that turns verification
# or the offline checks off.
# Seam for the tests: GELDAR_MOD_GRADLE runs that command instead of the wrapper, in neoforge/, with the single argument build.
# It is refused unless GELDAR_MOD_ALLOW_SEAM=1 is set too.
# The script never prints or writes a secret.
set -eu
set +x
# The ambient variables that could weaken the build are cleared first. Only the wrapper's own settings apply after this.
unset GRADLE_OPTS JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS GRADLE_USER_HOME_OPTS
if [ -n "${GELDAR_MOD_GRADLE:-}" ] && [ "${GELDAR_MOD_ALLOW_SEAM:-}" != 1 ]; then
  echo "build-neoforge-mod: GELDAR_MOD_GRADLE is a test seam and needs GELDAR_MOD_ALLOW_SEAM=1 as well; refusing" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/../.." && pwd)
nf="$root/neoforge"
jar_name=geldar-neoforge.jar

usage() {
  echo "usage: sh deploy/scratch/build-neoforge-mod.sh <absolute-output-dir>" >&2
}

# The output dir: absolute (POSIX or a Windows drive path, which Git Bash also takes), and absent or empty.
check_out() {
  if [ -e "$out" ] && { [ ! -d "$out" ] || [ -n "$(ls -A "$out")" ]; }; then
    echo "build-neoforge-mod: $out exists and is not an empty directory; refusing to write into it" >&2
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
    echo "build-neoforge-mod: the output dir must be an absolute path; refusing: $out" >&2
    exit 1
    ;;
esac
check_out

# The source is clean. With a .git the status of neoforge/ must be empty; without one the tree must be an export, which the
# caller says with GELDAR_MOD_BUILD_FROM_EXPORT=1.
if [ -e "$root/.git" ]; then
  dirty=$(git -C "$root" status --porcelain -- neoforge) ||
    { echo "build-neoforge-mod: git status failed in $root; refusing" >&2; exit 1; }
  if [ -n "$dirty" ]; then
    echo "build-neoforge-mod: neoforge/ has changes or untracked files; the jar must come from a clean tree; refusing:" >&2
    printf '%s\n' "$dirty" >&2
    exit 1
  fi
  commit=$(git -C "$root" rev-parse HEAD) || { echo "build-neoforge-mod: git rev-parse failed; refusing" >&2; exit 1; }
elif [ "${GELDAR_MOD_BUILD_FROM_EXPORT:-}" = 1 ]; then
  # An invalid value is cleared, so the length check refuses it too (a newline inside the value is refused the same way).
  commit_in=${GELDAR_MOD_BUILD_COMMIT:-}
  case "$commit_in" in
    *[!0-9a-f]*) commit_in= ;;
  esac
  [ "${#commit_in}" -eq 40 ] ||
    { echo "build-neoforge-mod: export mode needs GELDAR_MOD_BUILD_COMMIT, the 40 lowercase hex commit the export was made from (git rev-parse origin/main before git archive); refusing" >&2; exit 1; }
  commit="$commit_in (export)"
else
  echo "build-neoforge-mod: $root has no .git; build from a git checkout, or from a git archive export with GELDAR_MOD_BUILD_FROM_EXPORT=1; refusing" >&2
  exit 1
fi

# The wrapper's Gradle version and its distribution checksum: the pin the wrapper checks before it runs Gradle.
props="$nf/gradle/wrapper/gradle-wrapper.properties"
[ -f "$props" ] || { echo "build-neoforge-mod: $props is missing; refusing" >&2; exit 1; }
props_text=$(tr -d '\r' < "$props")
wrapper_version=$(printf '%s\n' "$props_text" | sed -n 's|^distributionUrl=.*/gradle-\([0-9][0-9.]*\)-bin\.zip.*|\1|p' | head -n 1)
case "$wrapper_version" in
  '' | *[!0-9.]*) echo "build-neoforge-mod: no Gradle version in the wrapper properties; refusing" >&2; exit 1 ;;
esac
printf '%s\n' "$props_text" | grep -Eq '^distributionSha256Sum=[0-9a-f]{64}$' ||
  { echo "build-neoforge-mod: the wrapper has no distributionSha256Sum; refusing" >&2; exit 1; }

# The build. Windows (Git Bash) runs gradlew.bat; elsewhere the wrapper runs under sh, so a checkout without the executable
# bit still works. Either way the only argument is build, and the wrapper's own checks stay on.
if [ -n "${GELDAR_MOD_GRADLE:-}" ]; then
  (cd "$nf" && "$GELDAR_MOD_GRADLE" build) || { echo "build-neoforge-mod: the build failed; no jar written" >&2; exit 1; }
else
  case $(uname -s) in
    MINGW* | MSYS* | CYGWIN*)
      (cd "$nf" && ./gradlew.bat build) || { echo "build-neoforge-mod: the build failed; no jar written" >&2; exit 1; }
      ;;
    *)
      (cd "$nf" && sh ./gradlew build) || { echo "build-neoforge-mod: the build failed; no jar written" >&2; exit 1; }
      ;;
  esac
fi

# Exactly one jar: the one that is neither -sources nor -javadoc.
libs="$nf/build/libs"
jars=""
if [ -d "$libs" ]; then
  jars=$(find "$libs" -maxdepth 1 -type f -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar')
fi
count=$(printf '%s\n' "$jars" | grep -c . || true)
case "$count" in
  0)
    echo "build-neoforge-mod: no jar in $libs after the build; refusing" >&2
    exit 1
    ;;
  1) ;;
  *)
    echo "build-neoforge-mod: $count jars in $libs; the build must leave exactly one; refusing:" >&2
    printf '%s\n' "$jars" | while IFS= read -r j; do basename "$j"; done >&2
    exit 1
    ;;
esac
jar_path=$jars

# The jar's entries: the mod descriptor must be there and no Java source may be packed in. jar tf, or unzip -Z1 without a JDK.
if command -v jar >/dev/null 2>&1; then
  listing=$(jar tf "$jar_path") || { echo "build-neoforge-mod: jar tf could not read the jar; refusing" >&2; exit 1; }
elif command -v unzip >/dev/null 2>&1; then
  listing=$(unzip -Z1 "$jar_path") || { echo "build-neoforge-mod: unzip could not read the jar; refusing" >&2; exit 1; }
else
  echo "build-neoforge-mod: neither jar nor unzip is on PATH; cannot check the jar; refusing" >&2
  exit 1
fi
listing=$(printf '%s\n' "$listing" | tr -d '\r')
printf '%s\n' "$listing" | grep -qx 'META-INF/neoforge.mods.toml' ||
  { echo "build-neoforge-mod: the jar has no META-INF/neoforge.mods.toml; refusing" >&2; exit 1; }
java_count=$(printf '%s\n' "$listing" | grep -c '\.java$' || true)
if [ "$java_count" -ne 0 ]; then
  echo "build-neoforge-mod: the jar holds $java_count .java source files; the jar must hold only compiled classes; refusing" >&2
  exit 1
fi

# The output: copied only now, after every check. The dir is checked again, since the build took a while.
check_out
made_out=
[ -d "$out" ] || made_out=1
mkdir -p "$out"
wrote=1
cleanup() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ -n "${wrote:-}" ]; then
    rm -f "$out/$jar_name" "$out/$jar_name.sha256" "$out/geldar-neoforge.build-info"
    if [ -n "${made_out:-}" ]; then rmdir "$out" 2>/dev/null || true; fi
  fi
  exit "$rc"
}
trap cleanup EXIT
cp "$jar_path" "$out/$jar_name"
# The hash is taken in its own step: a pipeline would hide a failing sha256sum behind the sed's status.
hashed=$(cd "$out" && sha256sum -- "$jar_name") || { echo "build-neoforge-mod: sha256sum failed; no output kept" >&2; exit 1; }
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
  echo "commit=$commit"
  echo "built_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "gradle_wrapper=$wrapper_version"
  echo "java=$java_line"
  echo "jar=$jar_name"
  echo "jar_sha256=$sha"
  echo "jar_bytes=$size"
} > "$out/geldar-neoforge.build-info"

echo "jar: $out/$jar_name"
echo "size: $size bytes"
echo "sha256: $sha"
echo "compare the sha256 with a copy that comes by another channel than the jar; a hash that travels with the jar only guards corruption"

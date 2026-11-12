# Verifies the images of a release before colo-cd.sh changes anything (CD-2a, decision 0084). Sourced by colo-cd.sh
# after common.sh; it defines functions only and changes nothing. Every *_IMAGE line of the release manifest must:
#   1. be one of the seven Colo images, named as deploy/release.env.example and .github/workflows/colo-images.yml name
#      them (ghcr.io/sandboxservers/geldar-<name>@sha256:...), and
#   2. carry the OCI revision label org.opencontainers.image.revision equal to the release sha, read from the registry
#      with `docker buildx imagetools inspect <ref> --format '{{json .}}'` (the workflow sets the label from github.sha).
# A refusal names the image and the reason. It exits 1 through die before any container is restarted or any file is
# copied. COLO_CD_IMAGE_INSPECT replaces the inspect command (the tests use a shim); it is read as command words.
COLO_CD_IMAGE_PREFIX=ghcr.io/sandboxservers

# The GHCR package name of each manifest key (the names colo-images.yml pushes).
image_name_of() {
  case $1 in
    GELDAR_BODY_IMAGE) echo geldar-body ;;
    GELDAR_MIND_IMAGE) echo geldar-mind ;;
    GELDAR_EVENTSINK_IMAGE) echo geldar-eventsink ;;
    GELDAR_MCP_IMAGE) echo geldar-mcp ;;
    GELDAR_ADMIN_IMAGE) echo geldar-admin ;;
    GELDAR_GLASS_IMAGE) echo geldar-glass ;;
    GELDAR_REGISTER_IMAGE) echo geldar-register ;;
    *) return 1 ;;
  esac
}

refuse_image() {
  die "$* (nothing was restarted or refreshed)"
}

# Checks one image reference: the revision label of every platform in the metadata must equal the release sha.
check_revision() {
  key=$1
  ref=$2
  sha=$3
  # shellcheck disable=SC2086
  out=$(${COLO_CD_IMAGE_INSPECT:-docker buildx imagetools inspect} "$ref" --format '{{json .}}' 2>/dev/null) ||
    refuse_image "$key: cannot read the registry metadata for $ref"
  revs=$(printf '%s\n' "$out" | grep -o '"org\.opencontainers\.image\.revision"[[:space:]]*:[[:space:]]*"[^"]*"' |
    sed 's/.*"\([^"]*\)"$/\1/') || true
  [ -n "$revs" ] || refuse_image "$key: $ref has no org.opencontainers.image.revision label"
  while IFS= read -r rev; do
    [ "$rev" = "$sha" ] || refuse_image "$key: $ref was built from revision $rev, not from release sha $sha"
  done <<EOF
$revs
EOF
  say "image verified: $key is built from $sha"
}

# Checks every *_IMAGE line of the release manifest $1 against the release sha $2 (see the header). Other keys are skipped.
verify_images() {
  manifest=$1
  sha=$2
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      '' | '#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key=${line%%=*}
    ref=${line#*=}
    case $key in
      *_IMAGE) ;;
      *) continue ;;
    esac
    name=$(image_name_of "$key") || refuse_image "$key is not a Colo image name; refusing the release"
    case $ref in
      "$COLO_CD_IMAGE_PREFIX/$name@sha256:"*) ;;
      *) refuse_image "$key ($ref) is not under $COLO_CD_IMAGE_PREFIX/$name" ;;
    esac
    check_revision "$key" "$ref" "$sha"
  done <"$manifest"
}

#!/bin/sh
# Creates the GitHub Environments production, test and ephemeral, each with a required reviewer (G2-04).
# Run by the repo owner. Dry-run is the default: it prints the calls it would make and makes none.
# --apply reads each environment first (gh api GET) and PUTs it only when GitHub answers 404 (missing), so a second
# run writes nothing. Any other GET failure (5xx, auth, network) exits non-zero with no PUT for that environment.
# An existing environment is left as it is; change its reviewers in the GitHub settings, not here.
#
# Usage: sh deploy/genesis/azure/github-environments.sh --repo <owner/name> --reviewer-id <numeric id>
#          [--reviewer-type user|team] [--environments "production test ephemeral"] [--apply | --dry-run]
# The repo and the reviewer come from arguments. This file holds no account names, ids or secrets.
set -eu

REPO=""
REVIEWER=""
REVIEWER_TYPE="user"
ENVIRONMENTS="production test ephemeral"
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --reviewer-id) REVIEWER=$2; shift 2 ;;
    --reviewer-type) REVIEWER_TYPE=$2; shift 2 ;;
    --environments) ENVIRONMENTS=$2; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
  echo "--repo must be owner/name (letters, digits, dot, underscore, hyphen)" >&2
  exit 2
fi
case "$REVIEWER" in
  ''|*[!0-9]*) echo "--reviewer-id must be the numeric id of the user or team named by --reviewer-type" >&2; exit 2 ;;
esac
case "$REVIEWER_TYPE" in
  user) REVIEWER_KIND=User ;;
  team) REVIEWER_KIND=Team ;;
  *) echo "--reviewer-type must be user or team" >&2; exit 2 ;;
esac

BODY="{\"reviewers\":[{\"type\":\"$REVIEWER_KIND\",\"id\":$REVIEWER}],\"deployment_branch_policy\":{\"protected_branches\":true,\"custom_branch_policies\":false}}"

for ENV in $ENVIRONMENTS; do
  case "$ENV" in
    ''|*[!a-z0-9-]*) echo "bad environment name: $ENV" >&2; exit 2 ;;
  esac
  if [ "$APPLY" = 1 ]; then
    # gh prints "gh: Not Found (HTTP 404)" on stderr for a missing environment; any other failure stops the run.
    if GET_ERR=$(gh api "repos/$REPO/environments/$ENV" 2>&1 >/dev/null); then
      echo "exists environment $ENV (no write)"
    else
      case "$GET_ERR" in
        *"HTTP 404"*)
          printf '%s' "$BODY" | gh api -X PUT "repos/$REPO/environments/$ENV" --input - >/dev/null
          echo "created environment $ENV"
          ;;
        *)
          echo "GET repos/$REPO/environments/$ENV failed and is not a 404; no write made for $ENV" >&2
          exit 1
          ;;
      esac
    fi
  else
    echo "dry-run: would GET repos/$REPO/environments/$ENV and, if missing, PUT it with body $BODY"
  fi
done

if [ "$APPLY" = 0 ]; then
  echo "dry-run: no call made. Re-run with --apply to create the missing environments."
fi

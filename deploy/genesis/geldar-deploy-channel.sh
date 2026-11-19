#!/bin/sh
# Forced-command deploy channel (G3-02). The operator's authorized_keys line runs this as
#   command="/usr/local/libexec/geldar-deploy/channel <ENVIRONMENT>",restrict
# and sshd passes the client's request in SSH_ORIGINAL_COMMAND. $1 is the environment the key is bound to. The request
# must be exactly: <verb> <sha> <environment>, and the environment must be the bound one.
#   verb:        plan | apply. apply is the entrypoint's deploy verb. verify and restore are refused until the entrypoint
#                supports them (they are not visible in the repo).
#   sha:         40 lowercase hex characters, the main commit.
#   environment: the bound name, whose envs/<name>.yaml file is present in the allow-list directory on this target.
# Anything else is refused with a fixed message that names no input. A request with no command (a shell request) is refused.
# Output is names-only: the entrypoint's own output goes to the channel log, never to this process's stdout.
# The entrypoint is the root-owned one colo-deploy.yml calls as `sudo -n .../run {plan|deploy} <sha>`; this wrapper runs it
# through sudo (deploy/genesis/geldar-deploy.sudoers.template), which authorises exactly those two verbs and the sha pattern.
# The paths below are fixed. Tests run a copy with the paths and sudo substituted (deploy/test/genesis-deploy-channel.test.ts).
set -eu
IFS=' '
unset BASH_ENV ENV
PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
export PATH
ENTRY=/usr/local/libexec/geldar-deploy/run
ENV_DIR=/var/lib/geldar-deploy/envs
LOG=/var/lib/geldar-deploy/channel.log
LOCK=/var/lib/geldar-deploy/channel.lock
bound=${1-}

refuse() {
  echo "geldar-deploy: refused: $1"
  exit 1
}

[ -n "$bound" ] || refuse "this key is not bound to an environment"
cmd=${SSH_ORIGINAL_COMMAND-}
[ -n "$cmd" ] || refuse "no command; shell requests are not accepted"
# Only lowercase letters, digits, hyphens and single spaces may reach the split. Any shell metacharacter, quote or tab stops here.
case $cmd in
  *[!a-z0-9\ -]*) refuse "the request has characters outside the allowed set" ;;
esac
set -f
# shellcheck disable=SC2086
set -- $cmd
set +f
[ "$#" -eq 3 ] || refuse "the request must be: verb sha environment"
verb=$1
sha=$2
env_name=$3
case $verb in
  plan | apply) ;;
  verify | restore) refuse "$verb is not yet supported on this node" ;;
  *) refuse "unknown verb" ;;
esac
case $sha in
  *[!0-9a-f]*) refuse "the sha must be 40 lowercase hex characters" ;;
esac
[ "${#sha}" -eq 40 ] || refuse "the sha must be 40 lowercase hex characters"
case $env_name in
  '' | [!a-z0-9]* | *[!a-z0-9-]*) refuse "the environment is not in the allow-list" ;;
esac
[ "$env_name" = "$bound" ] || refuse "the environment is not the one this key is bound to"
[ -f "$ENV_DIR/$env_name.yaml" ] || refuse "the environment is not in the allow-list"

case $verb in
  apply) entry_verb=deploy ;;
  *) entry_verb=$verb ;;
esac
# The log and the lock are created by the installer for the operator; umask keeps anything new private.
umask 077
# One deploy at a time on this node. Without flock the channel says so and runs unserialised.
if command -v flock >/dev/null 2>&1; then
  exec 9>>"$LOCK"
  flock 9
else
  echo "geldar-deploy: flock is missing; deploys on this node are not serialised"
fi
echo "geldar-deploy: $verb $env_name started"
rc=0
# env -i: the entrypoint gets only PATH and the environment name, never the sshd environment. stdin is /dev/null and the
# lock descriptor is closed for the entrypoint.
# shellcheck disable=SC2086
env -i PATH="$PATH" GELDAR_DEPLOY_ENV="$env_name" sudo -n "$ENTRY" "$entry_verb" "$sha" </dev/null >>"$LOG" 2>&1 9>&- || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "geldar-deploy: $verb $env_name ok"
else
  echo "geldar-deploy: $verb $env_name failed (exit $rc; see the channel log on the target)"
fi
exit "$rc"

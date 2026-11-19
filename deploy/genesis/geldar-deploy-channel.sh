#!/bin/sh
# Forced-command deploy channel (G3-02). The deploy key's authorized_keys line runs this (command=) and sshd passes the
# client's request in SSH_ORIGINAL_COMMAND. The request must be exactly: <verb> <sha> <environment>
#   verb:        plan | apply | verify | restore. apply is the entrypoint's deploy verb; the others pass through.
#   sha:         40 lowercase hex characters, the main commit.
#   environment: a name whose envs/<name>.yaml file is present in the allow-list directory on this target.
# Anything else is refused with a fixed message that names no input. A request with no command (a shell request) is refused.
# Output is names-only: the entrypoint's own output goes to the channel log, never to this process's stdout.
# The entrypoint is the root-owned one colo-deploy.yml calls as `sudo -n .../run {plan|deploy} <sha>`; this wrapper runs
# it through sudo (deploy/genesis/geldar-deploy.sudoers.template), so the same code path runs. The entrypoint is not in the
# repo (docs/runbooks/node-only-config.md item 14); its verify and restore verbs are unknown here and are passed through.
# Env (set by the installer; tests override): GELDAR_CHANNEL_ENTRY, GELDAR_CHANNEL_ENV_DIR, GELDAR_CHANNEL_LOG,
#   GELDAR_CHANNEL_SUDO (default "sudo -n --preserve-env=GELDAR_DEPLOY_ENV"; empty runs the entrypoint directly).
set -eu
PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
export PATH
ENTRY=${GELDAR_CHANNEL_ENTRY:-/usr/local/libexec/geldar-deploy/run}
ENV_DIR=${GELDAR_CHANNEL_ENV_DIR:-/var/lib/geldar-deploy/envs}
LOG=${GELDAR_CHANNEL_LOG:-/var/lib/geldar-deploy/channel.log}
SUDO=${GELDAR_CHANNEL_SUDO-sudo -n --preserve-env=GELDAR_DEPLOY_ENV}

refuse() {
  echo "geldar-deploy: refused: $1"
  exit 1
}

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
  plan | apply | verify | restore) ;;
  *) refuse "unknown verb" ;;
esac
case $sha in
  *[!0-9a-f]*) refuse "the sha must be 40 lowercase hex characters" ;;
esac
[ "${#sha}" -eq 40 ] || refuse "the sha must be 40 lowercase hex characters"
case $env_name in
  '' | [!a-z0-9]* | *[!a-z0-9-]*) refuse "the environment is not in the allow-list" ;;
esac
[ -f "$ENV_DIR/$env_name.yaml" ] || refuse "the environment is not in the allow-list"

case $verb in
  apply) entry_verb=deploy ;;
  *) entry_verb=$verb ;;
esac
echo "geldar-deploy: $verb $env_name started"
rc=0
# env -i: the entrypoint gets only PATH and the environment name, never the sshd environment.
# shellcheck disable=SC2086
env -i PATH="$PATH" GELDAR_DEPLOY_ENV="$env_name" $SUDO "$ENTRY" "$entry_verb" "$sha" >>"$LOG" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "geldar-deploy: $verb $env_name ok"
else
  echo "geldar-deploy: $verb $env_name failed (exit $rc; see the channel log on the target)"
fi
exit "$rc"

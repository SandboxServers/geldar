#!/bin/sh
# The human lane for deploy/nf-deploy.sh (velocity-human, compose/nf-live-human.yml). The script sources this file after it sets
# ROOT, PROJECT and PORT, and calls its die, say, act, dc, check_listener and check_operator. Sourcing runs nothing: it defines
# the lane's paths, its flag and its functions. NF_HUMAN (default off): on adds the overlay; unset or off adds nothing; any other
# value refuses (status, down and logs read only the switch; plan, up and refresh-secrets run every check below).
HUMAN_FILE=$ROOT/compose/nf-live-human.yml
HUMAN_TOML=$ROOT/compose/velocity/velocity-nf-human.toml
HUMAN_JAR=$ROOT/plugin/velocity-identity/build/libs/geldar-velocity-identity.jar
HUMAN=0

check_human_switch() {
  case ${NF_HUMAN-off} in
    off) HUMAN=0 ;;
    on) HUMAN=1 ;;
    *) die "NF_HUMAN must be on or off (default off); refusing" ;;
  esac
}

# One IPv4 address literal: exactly four decimal octets, each 0 to 255, with no leading zero. The charset test runs first, so
# colons, brackets, spaces, newlines, signs and hostnames are refused before any split. Case patterns and arithmetic only.
human_ipv4_ok() {
  case $1 in
    '' | *[!0-9.]* | .* | *. | *..*) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  set -- $1
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for octet in "$1" "$2" "$3" "$4"; do
    case $octet in
      0?*) return 1 ;;
    esac
    [ "${#octet}" -le 3 ] && [ "$octet" -le 255 ] || return 1
  done
  [ "$1$2$3$4" = "255255255255" ] && return 1
  return 0
}

# On: NF_HUMAN_BIND is one IPv4 address, not 0.0.0.0 (all interfaces) or the broadcast address. NF_HUMAN_PORT, if set, is a plain number
# from 1024 to 65535 with no leading zero, and not 25565, 25566 or the live port. The overlay's mounted files must exist, and the
# identity jar must not be empty. All of it runs before any docker call. HUMAN_BIND and HUMAN_PORT (default 46566, as the overlay)
# are set for the port gate.
check_human_inputs() {
  check_human_switch
  [ "$HUMAN" = 1 ] || return 0
  HUMAN_BIND=${NF_HUMAN_BIND-}
  human_ipv4_ok "$HUMAN_BIND" ||
    die "NF_HUMAN_BIND must be set to one IPv4 address such as 127.0.0.1 (NF_HUMAN=on; an IPv6 or wildcard value, brackets, hostnames and blanks are refused); refusing"
  case $HUMAN_BIND in
    0.0.0.0) die "NF_HUMAN_BIND $HUMAN_BIND is a wildcard address; the human lane never binds all interfaces; refusing" ;;
  esac
  HUMAN_PORT=${NF_HUMAN_PORT-46566}
  case $HUMAN_PORT in
    '' | *[!0-9]* | 0*) die "NF_HUMAN_PORT must be a number with no leading zero (default 46566); refusing" ;;
  esac
  [ "${#HUMAN_PORT}" -le 5 ] && [ "$HUMAN_PORT" -le 65535 ] || die "NF_HUMAN_PORT $HUMAN_PORT is above 65535; refusing"
  [ "$HUMAN_PORT" -ge 1024 ] || die "NF_HUMAN_PORT $HUMAN_PORT is below 1024 (the human lane uses 1024 to 65535); refusing"
  case $HUMAN_PORT in
    25565 | 25566 | "$PORT") die "NF_HUMAN_PORT $HUMAN_PORT is reserved (25565, 25566 and the live velocity port $PORT); refusing" ;;
  esac
  [ -f "$HUMAN_FILE" ] || die "overlay $HUMAN_FILE is missing; refusing"
  [ -f "$HUMAN_TOML" ] || die "compose/velocity/velocity-nf-human.toml is missing (the human proxy config); refusing"
  [ -f "$HUMAN_JAR" ] || die "the identity plugin jar is missing (build plugin/velocity-identity first; the overlay mounts it); refusing"
  [ -s "$HUMAN_JAR" ] || die "the identity plugin jar is empty (zero bytes); build plugin/velocity-identity again; refusing"
  # The human lane's NATS password (velocity-human reads it as nats-human.txt). Only the generator writes it; no path is printed.
  secdir=${NF_SECRETS_DIR:-$ROOT/compose/secrets-nf}
  [ -s "$secdir/nats-human.txt" ] || die "nats-human.txt is missing or empty in the NF secrets directory (NF_HUMAN=on needs it); re-run the NATS auth generator (./geldar.ps1 shard nats-auth nf --live, on the trusted machine), then copy the result to the node; refusing"
  say "human lane on: velocity-human publishes $HUMAN_BIND:$HUMAN_PORT->25565 (the only human publish)"
}

# On: the human port is free, or held only by velocity-human's own mapping $HUMAN_BIND:$HUMAN_PORT->25565/tcp (the agent port check is
# check_port, which counts only the velocity row).
check_human_port() {
  [ "$HUMAN" = 1 ] || return 0
  check_listener "$HUMAN_PORT" "$HUMAN_BIND" velocity-human
}

# A failed start of velocity-human stops that one service, so a proxy with no identity gate never keeps running and publishing its
# port. The overlay sets restart: "no", so the operator starts it again on purpose. Then the script exits non-zero.
human_fail() {
  if act dc stop velocity-human; then
    state="velocity-human is stopped (the human lane stays closed until you start it again)"
  else
    state="velocity-human could not be stopped: check docker ps before you do anything else"
  fi
  die "$1; $state"
}

# human-down: stops and removes velocity-human only. The overlay is always included, so it works with NF_HUMAN unset, and no
# other service is named. Plain down is unchanged.
cmd_human_down() {
  check_operator
  check_no_colo_labels
  HUMAN=1
  act dc rm -sf velocity-human
  say "human-down: velocity-human stopped and removed (no other service was touched)"
}

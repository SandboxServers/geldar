# Sourced by deploy/scratch/scratch.sh for the config verb (sh deploy/scratch/scratch.sh config [suffix]). Compose renders the project
# that up would start, with every relative source resolved, and exits with compose's status. It runs the same environment checks
# and the same compose_run as up, so its -f list cannot drift from up's. It creates no secrets directory, no state, no volume and
# no container, and it needs neither the plugin jars nor the BlueMap files (up checks those; config does not).

do_config() {
  set_env
  check_mod_env
  check_compose
  check_uid
  compose_run config
}

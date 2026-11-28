# Sourced by do_up before the resource gate runs. RAM_MIN_KB and DISK_MIN_KB come from scratch.sh.
free_ram_kb() {
  if [ "$(uname -s)" = Linux ]; then
    awk '/^MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null
  else
    powershell.exe -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory" 2>/dev/null | tr -d '\r'
  fi
}

free_kb() {
  df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# A value the gate can compare: digits only, not empty.
is_kb() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  return 0
}

gb() {
  awk -v kb="$1" 'BEGIN { printf "%.1f GB", kb / 1048576 }'
}

gate() {
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || root=""
  ram=$(free_ram_kb)
  disk_repo=$(free_kb "$ROOT")
  disk_docker=""
  fallback=""
  if [ -n "$root" ] && [ -d "$root" ]; then
    disk_docker=$(free_kb "$root")
  elif [ -n "$root" ] && is_kb "$disk_repo"; then
    # Docker Desktop on Windows reports a root inside its Linux VM, which is not a host path: the repo drive stands in.
    fallback=1
  fi
  if ! is_kb "$ram" || ! is_kb "$disk_repo" || { [ -z "$fallback" ] && ! is_kb "$disk_docker"; }; then
    echo "gate: could not read free RAM or free disk as numbers (Docker root: '${root:-unknown}'); nothing started" >&2
    exit 3
  fi
  if [ -n "$fallback" ]; then
    disk=$disk_repo
    echo "gate: disk figure from the repo checkout $ROOT (docker root $root is not a host path)"
    echo "gate: free RAM $(gb "$ram") (need 10 GB), free disk $(gb "$disk") (need 20 GB, the repo checkout $ROOT)"
  else
    disk=$disk_repo
    if [ "$disk_docker" -lt "$disk" ]; then
      disk=$disk_docker
    fi
    echo "gate: free RAM $(gb "$ram") (need 10 GB), free disk $(gb "$disk") (need 20 GB, the smaller of $ROOT and Docker root $root)"
  fi
  if [ "$ram" -ge "$RAM_MIN_KB" ] && [ "$disk" -ge "$DISK_MIN_KB" ]; then
    return 0
  fi
  echo "gate failed: free RAM below 10 GB or free disk below 20 GB; nothing started" >&2
  exit 3
}

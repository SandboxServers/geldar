#!/usr/bin/env bash
# bootstrap-packages.sh: apt packages for a Geldar host. Docker Engine and Compose v2 come from the upstream Docker
# repository (signed-by keyring, fingerprint pinned, versions pinned by the environment file). git must be >= 2.40
# after the step (Debian 12 gets git from bookworm-backports). Also: time sync, sysctl for Paper, log rotation, and
# the Docker packages held back from unattended upgrades. Sourced by bootstrap.sh, which supplies mut, say, die,
# write_if_changed, CHANGED and BOOT_ROOT.

GIT_FLOOR=2.40
BASE_PACKAGES="ca-certificates curl gnupg jq openssl xz-utils unattended-upgrades"
DOCKER_PACKAGES="docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
export DEBIAN_FRONTEND=noninteractive

# version_ge A B: true when dotted version A is at least B.
version_ge() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$2" ]
}

# installed_version PKG: the installed apt version, empty when the package is absent.
installed_version() {
  dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true
}

# git_version: the dotted version of the git on PATH; empty when git is absent.
git_version() {
  if ! command -v git >/dev/null 2>&1; then
    return 0
  fi
  git --version | sed -n 's/^git version \([0-9][0-9.]*[0-9]\).*/\1/p'
}

# base_packages: installs the missing base packages (curl is needed for the Docker key).
base_packages() {
  local missing=() pkg
  for pkg in $BASE_PACKAGES; do
    if [ -z "$(installed_version "$pkg")" ]; then
      missing+=("$pkg")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    mut apt-get update
    mut apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

# docker_key_ok FILE: the keyring holds the pinned Docker repository key.
docker_key_ok() {
  [ -s "$1" ] && gpg --show-keys --with-colons "$1" 2>/dev/null | grep -q "^fpr:.*:$GELDAR_DOCKER_KEY_FPR:\$"
}

# write_docker_key: fetches the Docker key only when it is missing, and checks its fingerprint before installing.
write_docker_key() {
  local keyring=$BOOT_ROOT/etc/apt/keyrings/docker.asc tmp
  if docker_key_ok "$keyring"; then
    return 0
  fi
  if [ "$MODE" != apply ]; then
    say "dry-run: fetch the Docker repository key and check the pinned fingerprint"
    return 0
  fi
  tmp=$(mktemp)
  curl -fsSL -o "$tmp" https://download.docker.com/linux/debian/gpg
  docker_key_ok "$tmp" || die "the Docker repository key does not match the pinned fingerprint"
  CHANGED=1
  ensure_dir "$(dirname "$keyring")" 755 0 0
  mut install -m 644 -o 0 -g 0 "$tmp" "$keyring"
  rm -f "$tmp"
}

# write_apt_sources: the Docker repository (signed-by its keyring) and, on Debian 12, bookworm-backports for git.
write_apt_sources() {
  local keyring=$BOOT_ROOT/etc/apt/keyrings/docker.asc
  write_docker_key
  write_if_changed "$BOOT_ROOT/etc/apt/sources.list.d/docker.sources" 644 0 0 <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $OS_CODENAME
Components: stable
Signed-By: $keyring
EOF
  if [ "$OS_VERSION" = 12 ]; then
    write_if_changed "$BOOT_ROOT/etc/apt/sources.list.d/bookworm-backports.sources" 644 0 0 <<'EOF'
Types: deb
URIs: https://deb.debian.org/debian
Suites: bookworm-backports
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
  fi
}

# docker_packages: the Docker packages at the pinned versions (each one checked against its own pin).
docker_packages() {
  local entry name ver want=()
  for entry in \
    "docker-ce:$GELDAR_DOCKER_CE_VERSION" \
    "docker-ce-cli:$GELDAR_DOCKER_CE_VERSION" \
    "containerd.io:$GELDAR_CONTAINERD_VERSION" \
    "docker-buildx-plugin:$GELDAR_DOCKER_BUILDX_VERSION" \
    "docker-compose-plugin:$GELDAR_DOCKER_COMPOSE_VERSION"; do
    name=${entry%%:*}
    ver=${entry#*:}
    if [ "$(installed_version "$name")" != "$ver" ]; then
      want+=("$name=$ver")
    fi
  done
  if [ "${#want[@]}" -gt 0 ]; then
    mut apt-get install -y --no-install-recommends "${want[@]}"
  fi
}

# git_floor_packages: installs git when it is missing or below the floor (Debian 12 from bookworm-backports).
git_floor_packages() {
  local have
  have=$(git_version)
  if [ -n "$have" ] && version_ge "$have" "$GIT_FLOOR"; then
    return 0
  fi
  if [ "$OS_VERSION" = 12 ]; then
    mut apt-get install -y --no-install-recommends -t bookworm-backports git
  else
    mut apt-get install -y --no-install-recommends git
  fi
}

# verify_git_floor: git must be >= 2.40 after the packages step. Dry-run only reports: it cannot upgrade anything.
verify_git_floor() {
  local have
  have=$(git_version)
  if [ -n "$have" ] && version_ge "$have" "$GIT_FLOOR"; then
    say "git $have ok (floor $GIT_FLOOR)"
    return 0
  fi
  if [ "$MODE" = apply ]; then
    die "git is ${have:-missing} after the packages step; the floor is $GIT_FLOOR"
  fi
  say "dry-run: git is ${have:-missing} now; apply installs git >= $GIT_FLOOR"
}

packages_step() {
  base_packages
  CHANGED=0
  write_apt_sources
  if [ "$CHANGED" = 1 ]; then
    mut apt-get update
  fi
  docker_packages
  git_floor_packages
}

# unattended_step: the Docker packages are held; unattended upgrades keep the rest.
unattended_step() {
  local held pkg missing=0
  held=$(apt-mark showhold 2>/dev/null || true)
  for pkg in $DOCKER_PACKAGES; do
    if ! grep -qx "$pkg" <<<"$held"; then
      missing=1
    fi
  done
  if [ "$missing" = 1 ]; then
    mut apt-mark hold $DOCKER_PACKAGES
  fi
}

# timesync_step: systemd-timesyncd keeps the clock right (Paper and the TLS edge both need it).
timesync_step() {
  if ! systemctl is-enabled -q systemd-timesyncd 2>/dev/null; then
    mut systemctl enable --now systemd-timesyncd
  fi
}

# sysctl_step: the map count Paper's JVM needs; reloaded only when the file changes.
sysctl_step() {
  CHANGED=0
  write_if_changed "$BOOT_ROOT/etc/sysctl.d/90-geldar-paper.conf" 644 0 0 <<'EOF'
# Set by deploy/genesis/bootstrap-packages.sh for Paper (JVM memory maps and inotify watches).
vm.max_map_count = 262144
fs.inotify.max_user_instances = 512
EOF
  if [ "$CHANGED" = 1 ]; then
    mut sysctl -q -p "$BOOT_ROOT/etc/sysctl.d/90-geldar-paper.conf"
  fi
}

# logrotate_step: rotates the environment's own logs; container logs are rotated by Docker.
logrotate_step() {
  CHANGED=0
  write_if_changed "$BOOT_ROOT/etc/logrotate.d/geldar-$GELDAR_ENV_NAME" 644 0 0 <<EOF
$GELDAR_STATE_DIR/logs/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
EOF
}

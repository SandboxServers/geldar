#!/usr/bin/env bash
# bootstrap-firewall.sh: nftables, the one firewall choice (ufw is not used). The input hook drops by default. It
# accepts loopback, established traffic, ICMP, container bridges (container to host), and the TCP ports the host
# serves: BOOTSTRAP_SSH_PORT, GELDAR_PUBLIC_TCP_PORTS, and any port sshd listens on. Docker-published ports bypass
# this input chain (Docker writes its own DNAT and forward rules, which this table does not see). The repo's
# loopback-ports check keeps published ports on 127.0.0.1, so they stay closed to the network. GELDAR_PUBLIC_TCP_PORTS
# governs only host services: listing a container's published port here does not open it. Sourced by bootstrap.sh.

# sshd_ports: the TCP ports sshd listens on (sshd -T, else ss filtered to sshd), then the server port of this session.
sshd_ports() {
  local out=
  out=$(sshd -T 2>/dev/null | sed -n 's/^port //p') || true
  if [ -z "$out" ] && command -v ss >/dev/null 2>&1; then
    out=$(ss -H -ltnp 2>/dev/null | grep sshd | awk '{print $4}' | sed 's/.*://') || true
  fi
  printf '%s\n' "$out"
  if [ -n "${SSH_CONNECTION:-}" ]; then
    printf '%s\n' "$SSH_CONNECTION" | awk '{print $4}'
  fi
  return 0
}

# firewall_ports: sets FW_PORTS (the effective list: settings plus detected sshd ports) and FW_UNLISTED (detected sshd
# ports that the settings do not allow).
firewall_ports() {
  local allowed detected p
  # Ports are read in base ten, so 0022 and 22 are the same port in the list and in the SSH guard.
  allowed=$(for p in ${GELDAR_PUBLIC_TCP_PORTS//,/ } "$BOOTSTRAP_SSH_PORT"; do printf '%s\n' "$((10#$p))"; done | sort -un)
  detected=$(sshd_ports | grep -E '^[0-9]+$' | while read -r p; do printf '%s\n' "$((10#$p))"; done | sort -un || true)
  FW_UNLISTED=
  for p in $detected; do
    grep -qx "$p" <<<"$allowed" || FW_UNLISTED="$FW_UNLISTED $p"
  done
  FW_PORTS=$(printf '%s\n%s\n' "$allowed" "$detected" | grep -E '^[0-9]+$' | sort -un | paste -sd, -)
}

# firewall_ports_check: in apply, an sshd port the settings do not allow stops the run before any rule is loaded.
firewall_ports_check() {
  firewall_ports
  [ -z "$FW_UNLISTED" ] && return 0
  if [ "$MODE" = apply ]; then
    die "sshd listens on TCP port(s)$FW_UNLISTED, which BOOTSTRAP_SSH_PORT and GELDAR_PUBLIC_TCP_PORTS do not allow; no rule is loaded (SSH lockout guard)"
  fi
  say "dry-run: WARNING: sshd listens on TCP port(s)$FW_UNLISTED that the settings do not allow; apply stops here"
}

# append_include FILE LINE: adds LINE as its own line, after a newline when FILE does not end with one.
append_include() {
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then
    printf '\n' >>"$1"
  fi
  printf '%s\n' "$2" >>"$1"
}

# ensure_nft_include FILE: nftables.conf loads the environment's file at boot. The line is added once.
ensure_nft_include() {
  local conf=$BOOT_ROOT/etc/nftables.conf line="include \"$1\""
  if [ -f "$conf" ] && grep -qxF "$line" "$conf"; then
    return 0
  fi
  mut append_include "$conf" "$line"
}

firewall_step() {
  local table file
  table="geldar_$GELDAR_ENV_NAME"
  file=$BOOT_ROOT/etc/nftables.d/geldar-$GELDAR_ENV_NAME.nft
  firewall_ports
  say "effective TCP ports: $FW_PORTS"
  CHANGED=0
  write_if_changed "$file" 644 0 0 <<EOF
# Managed by deploy/genesis/bootstrap-firewall.sh for environment $GELDAR_ENV_NAME. Do not edit by hand.
add table inet $table
flush table inet $table
table inet $table {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state established,related accept
    meta l4proto { icmp, ipv6-icmp } accept
    iifname "docker0" accept
    iifname "br-*" accept
    tcp dport { ${FW_PORTS//,/, } } accept
  }
}
EOF
  if [ "$MODE" = apply ]; then
    # A file that does not parse stops the run before the include line is added, so boot never loads it.
    nft -c -f "$file" || die "the nftables file $file does not parse; no include line was added"
  else
    say "dry-run: nft -c -f $file"
  fi
  ensure_nft_include "$file"
  # Rules load when the file changed or the table is not loaded (a failed earlier load is completed on a rerun).
  if [ "$CHANGED" = 1 ] || ! nft list table inet "$table" >/dev/null 2>&1; then
    mut nft -f "$file"
  fi
  if ! systemctl is-enabled -q nftables 2>/dev/null; then
    mut systemctl enable nftables
  fi
}

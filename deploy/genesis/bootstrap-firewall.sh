#!/usr/bin/env bash
# bootstrap-firewall.sh: nftables, the one firewall choice (ufw is not used). The input hook drops by default. It
# accepts loopback, established traffic, ICMP, container bridges (container to host), SSH and the TCP ports the
# environment marks public. Ports published on loopback stay closed to the network. Docker's own forwarding rules
# are not touched, so a published port must also be listed as public here to be reachable. Sourced by bootstrap.sh.

# firewall_port_set: the accepted TCP ports as a comma list. Exits the run on a non-port entry.
firewall_port_set() {
  local p ports=()
  for p in ${GELDAR_PUBLIC_TCP_PORTS//,/ } "$BOOTSTRAP_SSH_PORT"; do
    if ! [[ "$p" =~ ^[0-9]+$ ]] || [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then
      die "GELDAR_PUBLIC_TCP_PORTS has an entry that is not a TCP port number"
    fi
    ports+=("$p")
  done
  printf '%s\n' "${ports[@]}" | sort -un | paste -sd, -
}

# ensure_nft_include FILE: nftables.conf loads the environment's file at boot. The line is added once.
ensure_nft_include() {
  local conf=$BOOT_ROOT/etc/nftables.conf line="include \"$1\""
  if [ -f "$conf" ] && grep -qxF "$line" "$conf"; then
    return 0
  fi
  if [ "$MODE" = apply ]; then
    printf '%s\n' "$line" | tee -a "$conf" >/dev/null
  else
    say "dry-run: add the include line for $1 to $conf"
  fi
}

firewall_step() {
  local ports table file
  ports=$(firewall_port_set)
  table="geldar_$GELDAR_ENV_NAME"
  file=$BOOT_ROOT/etc/nftables.d/geldar-$GELDAR_ENV_NAME.nft
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
    tcp dport { $ports } accept
  }
}
EOF
  ensure_nft_include "$file"
  if [ "$CHANGED" = 1 ]; then
    mut nft -f "$file"
  fi
  if ! systemctl is-enabled -q nftables 2>/dev/null; then
    mut systemctl enable nftables
  fi
}

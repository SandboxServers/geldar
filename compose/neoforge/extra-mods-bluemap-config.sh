#!/bin/sh
# BlueMap config bundle loader for the NeoForge entrypoint (compose/neoforge/neoforge-entrypoint.sh). Mounted read-only at
# /geldar/extra-mods/bluemap-config.sh by the BlueMap overlays only. The entrypoint checks this file's sha256 against the pin in
# GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256 before it sources the file, and calls geldar_bluemap_install_config once.
# It is sourced into the entrypoint shell: it uses the entrypoint's set -eu and never runs on its own. Only names are printed.
#
# BlueMap's config bundle (plugins/bluemap/neoforge, committed with MANIFEST.sha256) is verified against its manifest, then
# installed into $data/config/bluemap before the start. A refusal exits before anything is copied or started.
# BlueMap reads config/bluemap relative to the working directory (ForgeMod.java:197-198 of BlueMap v5.29).
bluemap_refuse() {
  echo "neoforge-entrypoint: $1; refusing to start" >&2
  exit 1
}

# bluemap_verify DIR: DIR is the bundle: a regular directory with a regular MANIFEST.sha256; every manifest line is "<sha256>  <path>",
# the path a .conf file (one directory level at most), and that file is a regular non-symlink file with the hash; DIR holds no symlink
# and no file the manifest does not list (the manifest itself is listed).
bluemap_verify() {
  [ -d "$1" ] && [ ! -L "$1" ] && [ -r "$1" ] || bluemap_refuse "the BlueMap config bundle $1 is missing, not a directory or unreadable"
  m=$1/MANIFEST.sha256
  [ -f "$m" ] && [ ! -L "$m" ] && [ -r "$m" ] || bluemap_refuse "the BlueMap config bundle has no regular MANIFEST.sha256"
  [ -z "$(find "$1" -type l | head -n 1)" ] || bluemap_refuse "the BlueMap config bundle holds a symlink"
  bad=$(awk 'NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-f]/ || $2 !~ /^([A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.conf$/ { print NR; exit }' "$m")
  [ -z "$bad" ] || bluemap_refuse "the BlueMap MANIFEST.sha256 line $bad is not '<sha256>  <path>'"
  while read -r want rel; do
    [ -f "$1/$rel" ] && [ ! -L "$1/$rel" ] || bluemap_refuse "the BlueMap config bundle lacks the file $rel"
    got=$(sha256sum "$1/$rel" | awk '{print $1}')
    [ "$got" = "$want" ] || bluemap_refuse "the BlueMap config bundle file $rel does not match MANIFEST.sha256"
  done <"$m"
  want_list=$(awk 'NF > 0 { print $2 }' "$m"; echo MANIFEST.sha256)
  for f in $(cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort); do
    printf '%s\n' "$want_list" | grep -qxF -- "$f" || bluemap_refuse "the BlueMap config bundle holds $f, which MANIFEST.sha256 does not list"
  done
}

# bluemap_install: the verified bundle replaces the files in config/bluemap that differ. A differing file is kept once as <name>.operator-bak
# (not a .conf, so BlueMap never loads it; see bluemap_displace for an existing .operator-bak). maps/ and storages/ end with exactly the
# bundle's files: any other *.conf there is moved aside the same way. packs/ and the rest of the config dir are not touched. The copies go
# through .part (mode 644, the data dir's owner, re-hashed) and are renamed into place; the installed files are re-verified and a marker
# holding the manifest's sha256 is written last. Idempotent: identical files change nothing.
# bluemap_displace FILE REL: FILE (a regular file, REL its name for messages) is moved aside as FILE.operator-bak. When that backup
# already exists with the same content, FILE is dropped (nothing is lost). When it exists with other content, FILE is kept as
# FILE.operator-bak.<first 8 hex of FILE's sha256>; an existing backup of that name is never overwritten (a different one refuses).
bluemap_displace() {
  if [ ! -e "$1.operator-bak" ]; then
    mv -f "$1" "$1.operator-bak" || bluemap_refuse "cannot keep $2 as .operator-bak"
    return 0
  fi
  have=$(sha256sum "$1" | awk '{print $1}')
  kept=$(sha256sum "$1.operator-bak" | awk '{print $1}')
  if [ "$have" = "$kept" ]; then rm -f "$1"; return 0; fi
  alt=$1.operator-bak.$(printf '%s' "$have" | cut -c1-8)
  if [ -e "$alt" ]; then
    [ "$(sha256sum "$alt" | awk '{print $1}')" = "$have" ] || bluemap_refuse "cannot keep $2: ${alt##*/} exists with other content"
    rm -f "$1"
    return 0
  fi
  mv -f "$1" "$alt" || bluemap_refuse "cannot keep $2 as ${alt##*/}"
}

bluemap_install() {
  bluemap_verify "$bluemap_cfg_mount"
  mkdir -p "$bluemap_cfg/maps" "$bluemap_cfg/storages" || bluemap_refuse "cannot create $bluemap_cfg"
  chown --reference="$data" "$bluemap_cfg" "$bluemap_cfg/maps" "$bluemap_cfg/storages" || bluemap_refuse "cannot chown $bluemap_cfg"
  listed=$(awk 'NF > 0 { print $2 }' "$bluemap_cfg_mount/MANIFEST.sha256")
  while read -r want rel; do
    dest=$bluemap_cfg/$rel
    rm -f "$dest.part"
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      [ -f "$dest" ] && [ ! -L "$dest" ] || bluemap_refuse "$rel in config/bluemap is not a regular file"
      have=$(sha256sum "$dest" | awk '{print $1}')
      [ "$have" = "$want" ] && continue
      bluemap_displace "$dest" "$rel"
    fi
    cp "$bluemap_cfg_mount/$rel" "$dest.part" || bluemap_refuse "cannot copy $rel into config/bluemap"
    chmod 644 "$dest.part"
    chown --reference="$data" "$dest.part" || bluemap_refuse "cannot chown $rel"
    got=$(sha256sum "$dest.part" | awk '{print $1}')
    if [ "$got" != "$want" ]; then rm -f "$dest.part"; bluemap_refuse "the copy of $rel does not match MANIFEST.sha256; removed it"; fi
    mv -f "$dest.part" "$dest" || bluemap_refuse "cannot install $rel"
  done <"$bluemap_cfg_mount/MANIFEST.sha256"
  for dir in maps storages; do
    for f in "$bluemap_cfg/$dir"/*.conf; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      printf '%s\n' "$listed" | grep -qxF -- "$dir/${f##*/}" && continue
      bluemap_displace "$f" "$dir/${f##*/}"
    done
  done
  while read -r want rel; do
    [ "$(sha256sum "$bluemap_cfg/$rel" | awk '{print $1}')" = "$want" ] || bluemap_refuse "the installed $rel does not match MANIFEST.sha256"
  done <"$bluemap_cfg_mount/MANIFEST.sha256"
  marker=$bluemap_cfg/.geldar-config.sha256
  printf '%s\n' "$(sha256sum "$bluemap_cfg_mount/MANIFEST.sha256" | awk '{print $1}')" >"$marker.part" || bluemap_refuse "cannot write the config marker"
  chmod 644 "$marker.part"
  chown --reference="$data" "$marker.part" || bluemap_refuse "cannot chown the config marker"
  mv -f "$marker.part" "$marker" || bluemap_refuse "cannot install the config marker"
}

# geldar_bluemap_install_config BUNDLE DATA: BUNDLE is the mounted bundle directory, DATA the server data directory.
geldar_bluemap_install_config() {
  bluemap_cfg_mount=$1
  data=$2
  bluemap_cfg=$data/config/bluemap
  bluemap_install
}


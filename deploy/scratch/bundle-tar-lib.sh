# bundle-tar-lib.sh: the deterministic tar step of build-neoforge-bundle.sh. It is sourced, not executed: the script loads it
# with . "$dir/bundle-tar-lib.sh", where $dir is the script's own directory, and the tar test sources it on a fixture tree.
# POSIX sh, no shebang. It defines write_bundle_tar and runs nothing else when sourced.

# write_bundle_tar DIR LIST TAR SUMS: packs the names in LIST (paths relative to DIR, in any order) into the uncompressed tar TAR,
# sorted by name, with mtime 0, numeric owner 0:0 and no user names. SUMS gets two lines, the sha256 and the sha512 of TAR, each
# named with TAR's base name. It runs no docker, so a test can call it on a fixture directory. It needs GNU tar (--mtime).
write_bundle_tar() {
  wt_dir=$1; wt_list=$2; wt_tar=$3; wt_sums=$4
  tar --version 2>/dev/null | head -n 1 | grep -q '^tar (GNU tar)' ||
    { echo "build-neoforge-bundle: tar mode needs GNU tar (--mtime); refusing" >&2; return 1; }
  wt_vflag=""
  if tar --help 2>/dev/null | grep -q -- --verbatim-files-from; then wt_vflag=--verbatim-files-from; fi
  # The archive goes to stdout, as in the default path: GNU tar reads a Windows drive letter in -f (C:/...) as a host name.
  # --mode=go-w,u+rw sets the stored modes: group and other lose write, the owner gains read and write, and the exec bit stays.
  # So a umask of 022 or 002 gives the same bytes. A failed tar removes the partial archive, so no half-written tar is left.
  LC_ALL=C sort "$wt_list" | tar $wt_vflag --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=go-w,u+rw -cf - -C "$wt_dir" -T - > "$wt_tar" ||
    { rm -f "$wt_tar"; echo "build-neoforge-bundle: tar failed; removed the partial $wt_tar" >&2; return 1; }
  wt_name=$(basename -- "$wt_tar")
  wt_256=$(sha256sum < "$wt_tar" | awk '{ print $1 }')
  wt_512=$(sha512sum < "$wt_tar" | awk '{ print $1 }')
  printf '%s  %s\n%s  %s\n' "$wt_256" "$wt_name" "$wt_512" "$wt_name" > "$wt_sums"
}

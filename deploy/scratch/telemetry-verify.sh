#!/bin/sh
# Counts what the scratch OTLP sink recorded (see docs/runbooks/scratch-telemetry.md).
# Usage: sh deploy/scratch/telemetry-verify.sh metric <name> [expected]
#        sh deploy/scratch/telemetry-verify.sh event <name> [text]
#        sh deploy/scratch/telemetry-verify.sh absent <string>
# Reads $SCRATCH_TELEMETRY_OUT/*.jsonl (the sink's JSON lines, one OTLP export request per line).
# metric and event print "count=<n>" and the last value (metric) or the last record (event); exit 1 when the count is 0,
# or when expected (metric: numeric equality with the last value) or text (event: substring of the last record) does not
# match. absent exits 1 when the string occurs anywhere in the output. Exit 2 for usage errors or an unreadable directory.
set -u

usage() {
  echo "usage: sh deploy/scratch/telemetry-verify.sh metric|event <name> [expected] | absent <string>" >&2
  exit 2
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
kind=$1
needle=$2
expect=${3-}
case "$kind" in
  metric | event) ;;
  absent) [ "$#" -eq 2 ] || usage ;;
  *) usage ;;
esac
[ -n "$needle" ] || usage
if [ "$kind" != absent ]; then
  case "$needle" in
    *[!A-Za-z0-9_.:-]*)
      echo "telemetry-verify: name must match [A-Za-z0-9_.:-]+" >&2
      exit 2
      ;;
  esac
fi

dir=${SCRATCH_TELEMETRY_OUT:-}
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  echo "telemetry-verify: SCRATCH_TELEMETRY_OUT must name the sink output directory" >&2
  exit 2
fi
set -- "$dir"/*.jsonl
if [ ! -f "$1" ]; then
  echo "telemetry-verify: no .jsonl file in $dir" >&2
  [ "$kind" = absent ] && exit 0
  echo "count=0"
  exit 1
fi

if [ "$kind" = absent ]; then
  hits=$(cat "$@" | grep -F -c -- "$needle")
  if [ "$hits" -gt 0 ]; then
    echo "present: $hits line(s) contain the string"
    exit 1
  fi
  echo "absent"
  exit 0
fi

# A record names a signal with the quoted string: "name" of a metric, "eventName" or the event.name attribute of a log.
lines=$(cat "$@" | grep -F -- "\"$needle\"")
count=$(printf '%s' "$lines" | grep -o -F -- "\"$needle\"" | wc -l | tr -d ' ')
echo "count=$count"
if [ "$count" -eq 0 ]; then
  exit 1
fi
last=$(printf '%s\n' "$lines" | tail -n 1)

if [ "$kind" = event ]; then
  echo "last=$last"
  if [ -n "$expect" ]; then
    case "$last" in
      *"$expect"*) ;;
      *)
        echo "expected text not found in the last record" >&2
        exit 1
        ;;
    esac
  fi
  exit 0
fi

# The first data point after the last occurrence of the name on the last line.
value=$(printf '%s' "$last" | sed "s/^.*\"$needle\"//" | grep -o -E '"as(Double|Int)":"?-?[0-9.eE+-]+' | head -n 1 | sed 's/^"as[A-Za-z]*":"\{0,1\}//')
echo "last=${value:-none}"
if [ -n "$expect" ]; then
  if [ -z "$value" ] || ! awk -v a="$value" -v b="$expect" 'BEGIN { exit !(a + 0 == b + 0) }'; then
    echo "expected $expect, last value is ${value:-none}" >&2
    exit 1
  fi
fi
exit 0

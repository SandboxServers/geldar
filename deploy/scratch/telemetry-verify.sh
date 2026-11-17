#!/bin/sh
# Counts what the scratch OTLP sink recorded (see docs/runbooks/scratch-telemetry.md).
# Usage: sh deploy/scratch/telemetry-verify.sh metric <name> [expected]
#        sh deploy/scratch/telemetry-verify.sh max <name> [min]
#        sh deploy/scratch/telemetry-verify.sh histcount <name> [min_growth]
#        sh deploy/scratch/telemetry-verify.sh event <name> [text]
#        sh deploy/scratch/telemetry-verify.sh absent <string>
# metric, max and histcount take <name>@<key>=<value> to read one series of a labelled metric only (data points whose
# attributes hold that string attribute, e.g. geldar_paper_collector_disabled@collector=census).
# Reads $SCRATCH_TELEMETRY_OUT/*.jsonl (the sink's JSON lines, one OTLP export request per line). With
# SCRATCH_TELEMETRY_SINCE_LINE=<n> the first n lines are ignored (note `cat *.jsonl | wc -l` before an action to read
# only the exports after it).
# count = occurrences of the quoted name: once per export for a metric, twice for an event record (body and event.name).
# metric prints the LAST data point of that metric on the last export that holds it (the metric's own points only);
#   expected is numeric equality. A last value is a sample: a state held for less than two export intervals can be missed.
# max prints the largest data point of that metric over all exports read; min is a lower bound. Use it for a state that
#   holds only during a window (frozen, stall) together with SCRATCH_TELEMETRY_SINCE_LINE.
# histcount prints the first and last cumulative histogram count and their delta; min_growth is a lower bound on it.
# event prints the last record; text is a substring of it.
# All kinds exit 1 when the count is 0 or an expectation fails. absent exits 1 when the string occurs anywhere in the
# output. Exit 2 for usage errors or an unreadable directory.
set -u
usage() {
  echo "usage: sh deploy/scratch/telemetry-verify.sh metric|max|histcount|event <name> [expected] | absent <string>" >&2
  exit 2
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
kind=$1
needle=$2
expect=${3-}
case "$kind" in
  metric | event | max | histcount) ;;
  absent) [ "$#" -eq 2 ] || usage ;;
  *) usage ;;
esac
[ -n "$needle" ] || usage
fk=''
fv=''
case "$kind" in
  metric | max | histcount)
    case "$needle" in
      *@*=*)
        filter=${needle#*@}
        needle=${needle%%@*}
        fk=${filter%%=*}
        fv=${filter#*=}
        case "$fk$fv" in
          '' | *[!A-Za-z0-9_.:-]*)
            echo "telemetry-verify: the series filter must be <name>@<key>=<value> with [A-Za-z0-9_.:-]+" >&2
            exit 2
            ;;
        esac
        [ -n "$fk" ] && [ -n "$fv" ] || usage
        ;;
    esac
    ;;
esac
case "${SCRATCH_TELEMETRY_SINCE_LINE:-0}" in
  *[!0-9]*)
    echo "telemetry-verify: SCRATCH_TELEMETRY_SINCE_LINE must be a non-negative integer" >&2
    exit 2
    ;;
esac
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
lines=$(cat "$@" | tail -n +$(( ${SCRATCH_TELEMETRY_SINCE_LINE:-0} + 1 )) | grep -F -- "\"$needle\"")
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

# The data points of the named metric only: the text after its last "name" on the line, cut at the next "name".
segment() {
  seg=$(printf '%s' "$1" | sed "s/^.*\"$needle\"//" | sed 's/"name":".*$//')
  if [ -n "$fk" ]; then
    # Keep only the data points whose attributes hold key=value (attributes come first in a data point).
    printf '%s' "$seg" | sed 's/{"attributes":/\
{"attributes":/g' | grep -F -- "\"key\":\"$fk\",\"value\":{\"stringValue\":\"$fv\"}"
  else
    printf '%s' "$seg"
  fi
}
numbers() {
  grep -o -E '"as(Double|Int)":"?-?[0-9.eE+-]+' | sed 's/^"as[A-Za-z]*":"\{0,1\}//'
}
counts() {
  grep -o -E '"count":"?[0-9]+' | sed 's/^"count":"\{0,1\}//'
}

if [ "$kind" = histcount ]; then
  first=''
  final=''
  while IFS= read -r line; do
    c=$(segment "$line" | counts | head -n 1)
    [ -n "$c" ] || continue
    [ -n "$first" ] || first=$c
    final=$c
  done <<EOF
$lines
EOF
  if [ -z "$first" ]; then
    echo "histogram count: none"
    exit 1
  fi
  delta=$((final - first))
  echo "histcount first=$first last=$final delta=$delta"
  if [ -n "$expect" ] && [ "$delta" -lt "$expect" ]; then
    echo "expected a count growth of at least $expect, got $delta" >&2
    exit 1
  fi
  exit 0
fi

if [ "$kind" = max ]; then
  all=''
  while IFS= read -r line; do
    all="$all
$(segment "$line" | numbers)"
  done <<EOF
$lines
EOF
  value=$(printf '%s\n' "$all" | grep -v '^$' | sort -g | tail -n 1)
  echo "max=${value:-none}"
  if [ -n "$expect" ]; then
    if [ -z "$value" ] || ! awk -v a="$value" -v b="$expect" 'BEGIN { exit !(a + 0 >= b + 0) }'; then
      echo "expected a maximum of at least $expect, got ${value:-none}" >&2
      exit 1
    fi
  fi
  exit 0
fi

# metric: the last data point of the named metric on the last export (never a neighbour's value).
value=$(segment "$last" | numbers | tail -n 1)
echo "last=${value:-none}"
if [ -n "$expect" ]; then
  if [ -z "$value" ] || ! awk -v a="$value" -v b="$expect" 'BEGIN { exit !(a + 0 == b + 0) }'; then
    echo "expected $expect, last value is ${value:-none}" >&2
    exit 1
  fi
fi
exit 0

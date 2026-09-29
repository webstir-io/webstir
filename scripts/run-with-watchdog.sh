#!/usr/bin/env bash
# Runs a command, and if it outlives its limit, records what is still running before stopping it:
# the process tree, and each process's open files and pipes (Linux), so a hang shows its cause.
# Usage: scripts/run-with-watchdog.sh <seconds> <command...>
set -uo pipefail

limit="$1"
shift

# Its own process group, so everything it starts can be stopped together.
set -m
"$@" &
command_pid=$!
set +m

report() {
  echo "::error::'$*' ran for over ${limit}s; this is what was still running."
  ps -eo pid,ppid,pgid,etime,stat,args --forest 2>/dev/null || ps -ax -o pid,ppid,pgid,etime,stat,command
  if [ -d /proc ]; then
    for pid in $(pgrep -f 'bun|node|chrom' || true); do
      [ -d "/proc/$pid/fd" ] || continue
      echo "== $pid: $(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-200)"
      echo "   state: $(awk '/^State:/ { print $2, $3 }' "/proc/$pid/status" 2>/dev/null) wchan: $(cat "/proc/$pid/wchan" 2>/dev/null)"
      for fd in /proc/"$pid"/fd/*; do
        target="$(readlink "$fd" 2>/dev/null)" || continue
        case "$target" in
          pipe:*|socket:*)
            # Which other processes hold the same pipe or socket.
            holders="$(find /proc/[0-9]*/fd -lname "$target" 2>/dev/null | cut -d/ -f3 | sort -u | grep -vx "$pid" | tr '\n' ' ')"
            echo "   fd $(basename "$fd") -> $target shared with: ${holders:-none}"
            ;;
        esac
      done
    done
  fi
}

elapsed=0
while kill -0 "$command_pid" 2>/dev/null; do
  if [ "$elapsed" -ge "$limit" ]; then
    report "$@"
    kill -TERM -- "-$command_pid" 2>/dev/null
    sleep 5
    kill -KILL -- "-$command_pid" 2>/dev/null
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

wait "$command_pid"

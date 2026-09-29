#!/usr/bin/env bash
# Succeeds once main's Required Gate has passed on the content of a commit about to publish.
# Pull request CI tests the head merged with main as main was then. When the head already
# contains the commit's parent, everything on main at merge time, that base was in the head too
# (main only moves forward), so CI tested the head's own tree; if that tree is the commit's,
# the pull request's passing run counts. Otherwise this waits for the gate on the commit itself.
# Usage: scripts/wait-for-required-gate.sh <owner/repo> <sha>   (needs GH_TOKEN)
set -euo pipefail

repo="$1"
sha="$2"

gate() {
  gh api "repos/${repo}/commits/$1/check-runs?check_name=Required%20Gate" \
    --jq '[.check_runs[] | select(.status == "completed") | .conclusion] | first // "pending"'
}

tree="$(gh api "repos/${repo}/git/commits/${sha}" --jq '.tree.sha')"
parent="$(gh api "repos/${repo}/git/commits/${sha}" --jq '.parents[0].sha // ""')"
# A failed lookup only means waiting, but says so: a lost permission would otherwise cost every
# release the full wait unnoticed.
if ! heads="$(gh api "repos/${repo}/commits/${sha}/pulls" --jq '.[] | select(.merged_at != null) | .head.sha')"; then
  echo "::warning::Could not list the pull request that merged ${sha}; waiting for its own Required Gate."
  heads=""
fi
for head in $heads; do
  if [ -n "$parent" ] &&
    [ "$(gh api "repos/${repo}/git/commits/${head}" --jq '.tree.sha')" = "$tree" ] &&
    case "$(gh api "repos/${repo}/compare/${parent}...${head}" --jq '.status')" in
      ahead | identical) true ;;
      *) false ;;
    esac &&
    [ "$(gate "$head")" = "success" ]; then
    echo "Required Gate passed on ${head}, the merged pull request's head, with the same content as ${sha}"
    exit 0
  fi
done

for attempt in $(seq 1 120); do
  result="$(gate "$sha")"
  case "$result" in
    success) echo "Required Gate passed on ${sha}"; exit 0 ;;
    pending) sleep 30 ;;
    *) echo "::error::Required Gate concluded ${result} on ${sha}; not publishing."; exit 1 ;;
  esac
done
echo "::error::Required Gate did not finish on ${sha} within an hour; not publishing."
exit 1

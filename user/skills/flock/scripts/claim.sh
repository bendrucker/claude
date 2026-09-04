#!/usr/bin/env bash
# Singleton verdict plus the board skeleton, for bang-execution in SKILL.md.
#
# Reports only. It never creates, renames, focuses, or closes anything: a skill
# body is re-injected in full at every compaction, so a mutating load would fire
# again against a workspace the session has since moved on from.
#
# Degrades to one line rather than leaking an error into the skill body.
set -uo pipefail

LABEL=flock
DEFERRED="${XDG_CACHE_HOME:-$HOME/.cache}/claude/flock/deferred.json"

if [ -z "${HERDR_PANE_ID:-}" ]; then
  echo "NO HERDR (HERDR_PANE_ID unset). flock coordinates a herdr server and there is none here. Stop and say so."
  exit 0
fi

for tool in herdr jq git gh; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "NO HERDR ($tool is not on PATH). Stop and say so."
    exit 0
  }
done

if ! snapshot=$(herdr api snapshot 2>&1) || [ "${snapshot:0:1}" != "{" ]; then
  echo "NO HERDR (snapshot failed: ${snapshot%%$'\n'*}). Stop and say so."
  exit 0
fi

tmp=$(mktemp -d) || exit 0
trap 'rm -rf "$tmp"' EXIT

flock_ws=$(printf '%s' "$snapshot" | jq -r --arg l "$LABEL" '
  [.result.snapshot.workspaces[]? | select((.label // "") == $l) | .workspace_id][0] // ""' 2>/dev/null)
self_ws="${HERDR_WORKSPACE_ID:-}"

if [ -z "$flock_ws" ]; then
  echo "FLOCK  status=UNCLAIMED  self=$HERDR_PANE_ID"
  echo "  No workspace is labelled \"$LABEL\". Claim this one, or create one, before sweeping."
elif [ "$flock_ws" = "$self_ws" ]; then
  echo "FLOCK  status=OK  workspace=$flock_ws  self=$HERDR_PANE_ID"
else
  echo "FLOCK  status=ELSEWHERE  workspace=$flock_ws  self=$HERDR_PANE_ID"
  echo "  The flock already lives in $flock_ws. Focus it and stop, rather than sweeping from here."
fi
echo

# pane_id \t workspace label \t agent/status \t cwd
printf '%s' "$snapshot" | jq -r '
  .result.snapshot as $s
  | ($s.workspaces // []) as $ws
  | ($s.panes // [])[]
  | . as $p
  | ($ws[] | select(.workspace_id == $p.workspace_id) | .label // "") as $label
  | [ $p.pane_id,
      $label,
      ((if ($p.agent // "") == "" then "shell" else $p.agent end) + "/" + ($p.agent_status // "?")),
      ($p.foreground_cwd // $p.cwd // "")
    ] | @tsv' 2>/dev/null | sort > "$tmp/panes" || : > "$tmp/panes"

# Three seeds, so a worktree with no pane is still discovered. That is where
# work merged remotely but still open locally actually hides.

{
  cut -f4 "$tmp/panes"
  ls -d "$HOME"/src/.worktrees/*/*/* 2>/dev/null
  ls -d "$HOME"/.herdr/worktrees/*/* 2>/dev/null
} | sed '/^$/d' | sort -u > "$tmp/seeds"

while IFS= read -r dir; do
  [ -d "$dir" ] || continue
  common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
  root=$(cd "${common%/.git}" 2>/dev/null && pwd -P) || continue
  slug=$(git -C "$root" remote get-url origin 2>/dev/null |
    sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##')
  case "$slug" in */*) printf '%s\t%s\n' "$root" "$slug" ;; esac
done < "$tmp/seeds" | sort -u > "$tmp/repos"

# One subshell per repository, so the slowest repo sets the wall clock. gh
# overlaps with that repo's own git work.
#
# Only PRs on branches checked out here matter, and headRefName is the exact
# join from a worktree branch to its PR: one list call per discovered repo.

scan_repo() {
  local root=$1 slug=$2 out=$3
  local default merged prs wt branch flags ahead pr

  gh pr list --repo "$slug" --author @me --state open --limit 60 \
    --json number,headRefName,isDraft > "$out.gh" 2>/dev/null &
  local gh_pid=$!

  default=$(git -C "$root" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
  default=${default#origin/}
  [ -n "$default" ] || default=main
  merged=$(git -C "$root" branch --format='%(refname:short)' --merged "origin/$default" 2>/dev/null)

  wait "$gh_pid" 2>/dev/null
  prs=$(jq -r '.[]? | [.headRefName, (if .isDraft then "draft#" else "#" end) + (.number|tostring)] | @tsv' \
    "$out.gh" 2>/dev/null)

  git -C "$root" worktree list --porcelain 2>/dev/null |
    awk '/^worktree /{p=$2} /^branch /{sub(/^refs\/heads\//,"",$2); print p "\t" $2}' |
    while IFS=$'\t' read -r wt branch; do
      [ "$wt" = "$root" ] && continue
      flags=""
      [ -n "$(git -C "$wt" status --porcelain 2>/dev/null | head -1)" ] && flags="dirty"
      if git -C "$wt" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
        ahead=$(git -C "$wt" log '@{u}..HEAD' --oneline 2>/dev/null | wc -l | tr -d ' ')
      else
        ahead=$(git -C "$wt" log "origin/$default..HEAD" --oneline 2>/dev/null | wc -l | tr -d ' ')
      fi
      [ "${ahead:-0}" -gt 0 ] 2>/dev/null && flags="${flags:+$flags,}unpushed:$ahead"
      printf '%s\n' "$merged" | grep -qx -- "$branch" && flags="${flags:+$flags,}merged"
      pr=$(printf '%s\n' "$prs" | awk -F'\t' -v b="$branch" '$1==b {print $2; exit}')
      printf 'wt\t%s\t%s\t%s\t%s\t%s\n' "${slug##*/}" "$branch" "${pr:--}" "${flags:-clean}" "$wt"
    done > "$out"
  rm -f "$out.gh"
}

i=0
while IFS=$'\t' read -r root slug; do
  i=$((i + 1))
  scan_repo "$root" "$slug" "$tmp/repo.$i" &
done < "$tmp/repos"
wait

cat "$tmp"/repo.* 2>/dev/null | sort -t$'\t' -k2,2 -k3,3 > "$tmp/rows" || : > "$tmp/rows"

: > "$tmp/claimed"
: > "$tmp/board"
while IFS=$'\t' read -r _kind repo branch pr flags wt; do
  pane="-" agent="-"
  while IFS=$'\t' read -r pid _label ast cwd; do
    case "$cwd" in "$wt" | "$wt"/*)
      pane="$pid" agent="$ast"
      echo "$pid" >> "$tmp/claimed"
      break
      ;;
    esac
  done < "$tmp/panes"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$pane" "$agent" "$repo" "$branch" "$pr" "$flags" >> "$tmp/board"
done < "$tmp/rows"

# Agent panes on no worktree of their own: idle sessions, main checkouts, shells.
while IFS=$'\t' read -r pid label ast cwd; do
  case "$ast" in shell/*) continue ;; esac
  [ "$pid" = "$HERDR_PANE_ID" ] && continue
  grep -qx -- "$pid" "$tmp/claimed" 2>/dev/null && continue
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ast" "${label:--}" "-" "-" "no worktree" >> "$tmp/board"
done < "$tmp/panes"

awk -F'\t' '
  function fit(s, w) { return length(s) > w ? substr(s, 1, w - 1) "…" : s }
  BEGIN { printf "%-9s %-14s %-18s %-30s %-11s %s\n", "PANE", "AGENT", "REPO", "BRANCH", "PR", "FLAGS" }
  { printf "%-9s %-14s %-18s %-30s %-11s %s\n",
      fit($1, 9), fit($2, 14), fit($3, 18), fit($4, 30), fit($5, 11), $6 }
' "$tmp/board"

if [ -s "$DEFERRED" ]; then
  echo
  jq -r --arg cut "$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d)" '
    "deferred: \(length) (" + ([.[] | .key] | join(", ")) + ")",
    ( to_entries[] | select((.value.since // "9999-99-99") < $cut)
      | "  stale >14d, re-raise: \(.key) - \(.value.reason // "no reason recorded")" )
  ' "$DEFERRED" 2>/dev/null || echo "deferred: file unreadable ($DEFERRED)"
fi

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

tmp=$(mktemp -d) || exit 0
trap 'rm -rf "$tmp"' EXIT

# stderr stays out of the captured value. Folded in, one warning line ahead of
# the body would make a healthy server read as an outage.
if ! snapshot=$(herdr api snapshot 2>"$tmp/snapshot.err") || [ "${snapshot:0:1}" != "{" ]; then
  echo "NO HERDR (snapshot failed: $(head -1 "$tmp/snapshot.err")). Stop and say so."
  exit 0
fi

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
  | (($ws | map(select(.workspace_id == $p.workspace_id)) | .[0].label) // "") as $label
  | [ $p.pane_id,
      $label,
      ((if ($p.agent // "") == "" then "shell" else $p.agent end) + "/" + ($p.agent_status // "?")),
      ($p.foreground_cwd // $p.cwd // "")
    ] | @tsv' 2>/dev/null | sort > "$tmp/panes" || : > "$tmp/panes"

# Seeded from more than the live panes, because a worktree with no pane is
# where work merged remotely but still open locally actually hides. The
# snapshot names every repository herdr knows, whatever path layout it uses;
# the globs then cover checkouts herdr has never opened. git resolves one
# seed per repository rather than one per worktree, so a repo with twenty
# worktrees still costs one lookup.

repo_seed() {
  local repo_dir wt
  for repo_dir in "$@"; do
    for wt in "$repo_dir"*/; do
      # Any one checkout resolves the whole repository, but it has to be a real
      # one: stopping at the first bare directory lets a leftover hide every
      # worktree under it.
      [ -e "$wt.git" ] && { printf '%s\n' "${wt%/}"; break; }
    done
  done
}

{
  printf '%s' "$snapshot" | jq -r '
    [.result.snapshot.workspaces[]?.worktree?.repo_root // empty] | unique[]' 2>/dev/null
  cut -f4 "$tmp/panes"
  repo_seed "$HOME"/src/.worktrees/*/*/ "$HOME"/.herdr/worktrees/*/
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
  local default candidate merged prs wt branch flags ahead pr none="-"

  gh pr list --repo "$slug" --author @me --state open --limit 60 \
    --json number,headRefName,isDraft > "$out.gh" 2>/dev/null &
  local gh_pid=$!

  default=$(git -C "$root" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
  default=${default#origin/}
  # origin/HEAD goes unset on any checkout that never ran `git remote set-head`,
  # and guessing main against a master repo empties the merged list in silence.
  if [ -z "$default" ]; then
    for candidate in main master; do
      git -C "$root" rev-parse --verify --quiet "origin/$candidate" >/dev/null 2>&1 &&
        { default=$candidate; break; }
    done
  fi
  if [ -z "$default" ]; then
    echo "$slug: no default branch on origin, so merged branches go unflagged" >> "$tmp/warnings"
  else
    merged=$(git -C "$root" branch --format='%(refname:short)' --merged "origin/$default" 2>/dev/null)
  fi

  # An unreachable forge and a repo with no open PRs both leave jq nothing to
  # read, and the board must not present the first as the second.
  if wait "$gh_pid" 2>/dev/null; then
    prs=$(jq -r '.[]? | [.headRefName, (if .isDraft then "draft#" else "#" end) + (.number|tostring)] | @tsv' \
      "$out.gh" 2>/dev/null)
  else
    prs=""
    none="?"
    echo "$slug: open pull requests could not be listed, so its PR column reads ?" >> "$tmp/warnings"
  fi
  rm -f "$out.gh"

  git -C "$root" worktree list --porcelain > "$out.wt" 2>/dev/null ||
    echo "$slug: worktrees could not be listed, so none of its rows appear below" >> "$tmp/warnings"

  awk '/^worktree /{p=$2} /^branch /{sub(/^refs\/heads\//,"",$2); print p "\t" $2}' "$out.wt" 2>/dev/null |
    while IFS=$'\t' read -r wt branch; do
      [ "$wt" = "$root" ] && continue
      flags=""
      [ -n "$(git -C "$wt" status --porcelain 2>/dev/null | head -1)" ] && flags="dirty"
      ahead=$(git -C "$wt" rev-list --count '@{u}..HEAD' 2>/dev/null ||
        git -C "$wt" rev-list --count "origin/$default..HEAD" 2>/dev/null)
      [ "${ahead:-0}" -gt 0 ] 2>/dev/null && flags="${flags:+$flags,}unpushed:$ahead"
      printf '%s\n' "$merged" | grep -qx -- "$branch" && flags="${flags:+$flags,}merged"
      pr=$(printf '%s\n' "$prs" | awk -F'\t' -v b="$branch" '$1==b {print $2; exit}')
      printf 'wt\t%s\t%s\t%s\t%s\t%s\n' "${slug##*/}" "$branch" "${pr:-$none}" "${flags:-clean}" "$wt"
    done > "$out"
  rm -f "$out.wt"
}

i=0
while IFS=$'\t' read -r root slug; do
  i=$((i + 1))
  scan_repo "$root" "$slug" "$tmp/repo.$i" &
done < "$tmp/repos"
wait

cat "$tmp"/repo.[0-9]* 2>/dev/null | sort -t$'\t' -k2,2 -k3,3 > "$tmp/rows" || : > "$tmp/rows"

if [ -s "$tmp/warnings" ]; then
  sed 's/^/incomplete: /' "$tmp/warnings"
  echo
fi

claimed=" "
: > "$tmp/board"
while IFS=$'\t' read -r _kind repo branch pr flags wt; do
  pane="-" agent="-"
  while IFS=$'\t' read -r pid _label ast cwd; do
    case "$cwd" in "$wt" | "$wt"/*)
      pane="$pid" agent="$ast"
      claimed="$claimed$pid "
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
  case "$claimed" in *" $pid "*) continue ;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ast" "${label:--}" "-" "-" "no worktree" >> "$tmp/board"
done < "$tmp/panes"

awk -F'\t' '
  function fit(s, w) { return length(s) > w ? substr(s, 1, w - 1) "…" : s }
  BEGIN { printf "%-9s %-14s %-18s %-30s %-11s %s\n", "PANE", "AGENT", "REPO", "BRANCH", "PR", "FLAGS" }
  { printf "%-9s %-14s %-18s %-30s %-11s %s\n",
      fit($1, 9), fit($2, 14), fit($3, 18), fit($4, 30), fit($5, 11), $6 }
' "$tmp/board"

if [ -s "$DEFERRED" ]; then
  deferrals=$(jq -r --arg cut "$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d)" '
    select(length > 0)
    | "deferred: \(length) (\(keys_unsorted | join(", ")))",
      ( to_entries[] | select((.value.since // "9999-99-99") < $cut)
        | "  stale >14d, re-raise: \(.key) - \(.value.reason // "no reason recorded")" )
  ' "$DEFERRED" 2>/dev/null) || deferrals="deferred: file unreadable ($DEFERRED)"
  [ -n "$deferrals" ] && printf '\n%s\n' "$deferrals"
fi

# The block above ends on a test, and a report-only script must not hand the
# skill loader a failure because there was nothing to defer.
exit 0

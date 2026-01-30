#!/usr/bin/env bash
# Fetch PR context for update skill
# Args: <branch> <graphql-query-file>

branch="$1"
query_file="$2"
script_dir="${0%/*}"
wt_gh="$script_dir/wt-gh.sh"

owner=$("$wt_gh" "$branch" repo view --json owner --jq '.owner.login') || exit 1
repo=$("$wt_gh" "$branch" repo view --json name --jq '.name') || exit 1
number=$("$wt_gh" "$branch" pr view --json number --jq '.number') || exit 1

"$wt_gh" "$branch" api graphql \
  -F owner="$owner" \
  -F repo="$repo" \
  -F number="$number" \
  -f query="$(cat "$query_file")"

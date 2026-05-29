#!/bin/bash
input=$(cat)
segments=()

# Strip ANSI SGR and OSC 8 hyperlink sequences so width math counts only
# visible glyphs.
strip_escapes() {
  printf '%s' "$1" | sed -e $'s/\033\\[[0-9;]*m//g' -e $'s/\033\\]8;;[^\033]*\033\\\\//g'
}

visible_width() {
  local stripped
  stripped=$(strip_escapes "$1")
  printf '%s' "${#stripped}"
}

render_dial() {
  local pct
  pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
  if [ -z "$pct" ]; then
    return
  fi

  local int_pct color idx icon
  int_pct=$(printf '%.0f' "$pct")

  local exceeds_200k
  exceeds_200k=$(echo "$input" | jq -r '.exceeds_200k_tokens // false')

  if [ "$int_pct" -lt 40 ]; then
    color="\033[32m"
  elif [ "$int_pct" -lt 65 ]; then
    color="\033[33m"
  elif [ "$int_pct" -lt 80 ]; then
    color="\033[91m"
  else
    color="\033[31m"
  fi

  if [ "$exceeds_200k" = "true" ]; then
    if [ "$color" = "\033[32m" ]; then
      color="\033[33m"
    elif [ "$color" = "\033[33m" ] && [ "$int_pct" -ge 45 ]; then
      color="\033[31m"
    fi
  fi

  idx=$(( int_pct * 7 / 100 ))
  if [ "$idx" -gt 7 ]; then idx=7; fi
  icon=$(python3 -c "print(chr(0xF0A9E + $idx), end='')")

  segments+=("$(printf "${color}%s\033[0m" "$icon")")
}

render_lines() {
  local added removed
  added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
  removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

  if [ "$added" -eq 0 ] && [ "$removed" -eq 0 ]; then
    return
  fi

  local parts=""
  if [ "$added" -gt 0 ]; then
    parts=$(printf "\033[32m+%d\033[0m" "$added")
  fi
  if [ "$removed" -gt 0 ]; then
    if [ -n "$parts" ]; then
      parts+=" "
    fi
    parts+=$(printf "\033[31m-%d\033[0m" "$removed")
  fi

  segments+=("$parts")
}

# Middle-elide an ordered list of styled spans to a visible-width budget,
# preserving the start of the first span and the end of the last. Each span is
# emitted with its own escape wrapper intact, so OSC 8 hyperlinks and colors stay
# valid even when their anchor text is shortened. Reads parallel arrays
# span_text / span_pre / span_suf; prints the rendered label.
elide_spans() {
  local budget=$1
  local i total=0
  for i in "${!span_text[@]}"; do total=$(( total + ${#span_text[$i]} )); done

  if [ "$total" -le "$budget" ]; then
    for i in "${!span_text[@]}"; do
      printf '%s%s%s' "${span_pre[$i]}" "${span_text[$i]}" "${span_suf[$i]}"
    done
    return
  fi

  local keep=$(( budget - 1 ))
  if [ "$keep" -lt 1 ]; then keep=1; fi
  local head=$(( (keep + 1) / 2 ))
  local tail=$(( keep - head ))
  local tail_start=$(( total - tail ))

  local pos=0 out="" ellipsis_done=0
  for i in "${!span_text[@]}"; do
    local t="${span_text[$i]}"
    local len=${#t}
    local span_start=$pos
    local span_end=$(( pos + len ))
    local piece=""

    if [ "$span_start" -lt "$head" ]; then
      local h_end=$head
      if [ "$span_end" -lt "$h_end" ]; then h_end=$span_end; fi
      piece+="${t:0:$(( h_end - span_start ))}"
    fi

    if [ "$span_end" -gt "$tail_start" ]; then
      local t_begin=$tail_start
      if [ "$t_begin" -lt "$span_start" ]; then t_begin=$span_start; fi
      if [ "$ellipsis_done" -eq 0 ]; then piece+="…"; ellipsis_done=1; fi
      piece+="${t:$(( t_begin - span_start )):$(( span_end - t_begin ))}"
    fi

    if [ -n "$piece" ]; then
      out+="${span_pre[$i]}${piece}${span_suf[$i]}"
    fi
    pos=$span_end
  done

  if [ "$ellipsis_done" -eq 0 ]; then out+="…"; fi
  printf '%s' "$out"
}

render_worktree() {
  local budget=$1
  local wt_json repo branch ahead
  wt_json=$(wt list statusline --format=json 2>/dev/null | jq -c '.[] | select(.is_current)') || return
  if [ -z "$wt_json" ]; then
    return
  fi

  local dim=$'\033[2m'
  local reset=$'\033[0m'
  local cyan=$'\033[36m'

  branch=$(echo "$wt_json" | jq -r '.branch')
  local path ci_url repo_url
  path=$(echo "$wt_json" | jq -r '.path')
  repo=$(basename "$path")
  local sanitized_branch
  sanitized_branch=$(echo "$branch" | tr '/\\' '-')
  repo=${repo%%."$sanitized_branch"}

  ci_url=$(echo "$wt_json" | jq -r '.ci.url // empty')
  local repo_url=""
  if [ -n "$ci_url" ]; then
    local remote_name
    remote_name=$(echo "$wt_json" | jq -r '.remote.name // "origin"')
    repo_url=$(git remote get-url "$remote_name" 2>/dev/null | sed -e 's|^git@\([^:]*\):|https://\1/|' -e 's|\.git$||')
  fi

  local is_main
  is_main=$(echo "$wt_json" | jq -r '.is_main')

  # Collapse the repo≈branch redundancy: when the repo name is a prefix or
  # suffix of the sanitized branch, the branch already carries the repo, so show
  # the branch alone. Worktrunk names branches worktree-<id> against a <id>
  # worktree, so the repo is a suffix, not a prefix.
  local show_repo=true
  if [ "$is_main" = "false" ] && [ -n "$repo" ]; then
    if [[ "$sanitized_branch" == "$repo"* || "$sanitized_branch" == *"$repo" ]]; then
      show_repo=false
    fi
  fi

  # Build styled spans in visible order.
  span_text=()
  span_pre=()
  span_suf=()

  local repo_pre="" repo_suf=""
  if [ -n "$repo_url" ]; then
    repo_pre=$(printf '\033]8;;%s\033\\' "$repo_url")
    repo_suf=$(printf '\033]8;;\033\\')
  fi

  if [ "$is_main" = "true" ]; then
    span_text+=("$repo"); span_pre+=("$repo_pre"); span_suf+=("$repo_suf")
  else
    if [ "$show_repo" = "true" ]; then
      span_text+=("$repo"); span_pre+=("$repo_pre"); span_suf+=("$repo_suf")
      span_text+=("/"); span_pre+=("$dim"); span_suf+=("$reset")
    fi
    local branch_pre="$cyan" branch_suf="$reset"
    if [ -n "$ci_url" ]; then
      branch_pre=$(printf '%s\033]8;;%s\033\\' "$cyan" "$ci_url")
      branch_suf=$(printf '\033]8;;\033\\%s' "$reset")
    fi
    span_text+=("$branch"); span_pre+=("$branch_pre"); span_suf+=("$branch_suf")
  fi

  ahead=$(echo "$wt_json" | jq -r '.main.ahead // 0')
  local ahead_seg=""
  if [ "$ahead" -gt 0 ]; then
    ahead_seg="${dim}↑${ahead}${reset}"
  fi

  # Reserve room for the ahead segment (and its separator) before eliding.
  local label_budget=$budget
  if [ -n "$ahead_seg" ]; then
    label_budget=$(( budget - $(visible_width "$ahead_seg") - 2 ))
  fi

  if [ "$label_budget" -lt 3 ]; then
    if [ -n "$ahead_seg" ]; then
      segments+=("$ahead_seg")
    fi
    return
  fi

  local label
  label=$(elide_spans "$label_budget")
  segments+=("$label")
  if [ -n "$ahead_seg" ]; then
    segments+=("$ahead_seg")
  fi
}

sep="  "

render_dial
render_lines

# Fixed segments (dials) are rendered first and never elided; the worktree label
# takes whatever width remains so the dial stays visible at any terminal width.
fixed_width=0
for i in "${!segments[@]}"; do
  if [ "$i" -gt 0 ]; then
    fixed_width=$(( fixed_width + ${#sep} ))
  fi
  fixed_width=$(( fixed_width + $(visible_width "${segments[$i]}") ))
done

columns=${COLUMNS:-80}
if ! [ "$columns" -gt 0 ] 2>/dev/null; then columns=80; fi
worktree_budget=$(( columns - fixed_width - ${#sep} - 1 ))

render_worktree "$worktree_budget"

output=""
for i in "${!segments[@]}"; do
  if [ "$i" -gt 0 ]; then
    output+="$sep"
  fi
  output+="${segments[$i]}"
done

printf "%s" "$output"

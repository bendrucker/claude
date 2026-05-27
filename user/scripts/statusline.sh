#!/bin/bash
input=$(cat)
segments=()

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

render_dial
render_lines

sep="  "
output=""
for i in "${!segments[@]}"; do
  if [ "$i" -gt 0 ]; then
    output+="$sep"
  fi
  output+="${segments[$i]}"
done

printf "%s" "$output"

#!/bin/bash
input=$(cat)
pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

if [ -z "$pct" ]; then
  exit 0
fi

int_pct=$(printf '%.0f' "$pct")

if [ "$int_pct" -lt 40 ]; then
  color="\033[32m"
elif [ "$int_pct" -lt 65 ]; then
  color="\033[33m"
elif [ "$int_pct" -lt 80 ]; then
  color="\033[38;5;208m"
else
  color="\033[31m"
fi

# nf-md-circle_slice 1-8 (U+F0ABE..U+F0AC5) as a filling dial
idx=$(( int_pct * 7 / 100 ))
if [ "$idx" -gt 7 ]; then idx=7; fi
icon=$(python3 -c "print(chr(0xF0A9E + $idx), end='')")

printf "${color}%s\033[0m" "$icon"

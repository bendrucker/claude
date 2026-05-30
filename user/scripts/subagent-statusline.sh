#!/bin/bash
input=$(cat)

yellow=$'\033[33m'
green=$'\033[32m'
red=$'\033[31m'
dim=$'\033[2m'
reset=$'\033[0m'

# Purpose glyphs mark the agent kind (Explore/Plan/guide); cloud always marks
# remote agents. Untyped kinds (general-purpose, unknown) get no purpose glyph.
# Generated via python3 because macOS bash 3.2 lacks \u escapes.
read -r explore_glyph plan_glyph guide_glyph remote_glyph \
  < <(python3 -c "print(chr(0xF002), chr(0xF0EA), chr(0xF02D), chr(0xF0C2))")

# The subagentStatusLine payload omits the agent kind, but each task id keys a
# sidecar the harness writes next to the subagent transcript. Resolve it scoped
# to the current project's sessions (derived from $PWD, the session cwd the
# status line runs in) so we never scan unrelated projects. A miss yields an
# empty type and the purpose glyph is simply skipped (the prune signal if the
# harness ever changes this layout).
project_dir="$HOME/.claude/projects/$(printf '%s' "$PWD" | sed 's#[/.]#-#g')"

agent_type_for() {
  local id=$1 meta
  for meta in "$project_dir"/*/subagents/agent-"$id".meta.json; do
    [ -f "$meta" ] || continue
    jq -r '.agentType // empty' "$meta" 2>/dev/null
    return
  done
}

format_elapsed() {
  local start_ms=$1 now_ms elapsed_s mins secs
  now_ms=$(date +%s)000
  elapsed_s=$(( (now_ms - start_ms) / 1000 ))
  mins=$(( elapsed_s / 60 ))
  secs=$(( elapsed_s % 60 ))
  printf "%dm %ds" "$mins" "$secs"
}

format_tokens() {
  local count=$1
  if [ "$count" -ge 1000 ]; then
    printf "%.1fk" "$(echo "$count / 1000" | bc -l)"
  else
    printf "%d" "$count"
  fi
}

# Reads status_icon, purpose_glyph, remote_marker, text, and meta from the
# calling render_task scope (bash dynamic scoping). The purpose glyph leads, the
# cloud marker follows, so origin stays visible without displacing the kind.
build_content() {
  local body="${status_icon}"
  if [ -n "$purpose_glyph" ]; then
    body+=" ${purpose_glyph}"
  fi
  if [ -n "$remote_marker" ]; then
    body+=" ${remote_marker}"
  fi
  body+=" ${text}"
  if [ -n "$meta" ]; then
    body+=" ${dim}${meta}${reset}"
  fi
  printf '%s' "$body"
}

render_task() {
  local task=$1
  local columns=$2
  local id description type name status start_time token_count status_icon agent_type purpose_glyph remote_marker text meta content
  id=$(echo "$task" | jq -r '.id')
  description=$(echo "$task" | jq -r '.description // empty')
  type=$(echo "$task" | jq -r '.type // empty')
  name=$(echo "$task" | jq -r '.name // empty')
  status=$(echo "$task" | jq -r '.status // "running"')
  start_time=$(echo "$task" | jq -r '.startTime // empty')
  token_count=$(echo "$task" | jq -r '.tokenCount // 0')

  case "$status" in
    completed) status_icon="${green}✓${reset}" ;;
    failed)    status_icon="${red}✗${reset}" ;;
    *)         status_icon="${yellow}▶${reset}" ;;
  esac

  # The agent kind drives the purpose glyph; untyped kinds get none.
  agent_type=$(agent_type_for "$id")
  case "$agent_type" in
    Explore)           purpose_glyph="${dim}${explore_glyph}${reset}" ;;
    Plan)              purpose_glyph="${dim}${plan_glyph}${reset}" ;;
    claude-code-guide) purpose_glyph="${dim}${guide_glyph}${reset}" ;;
    *)                 purpose_glyph="" ;;
  esac

  # .type is the agent origin (local_agent or remote_agent). Cloud always marks
  # remote agents; local agents carry no origin marker.
  case "$type" in
    remote_agent) remote_marker="${dim}${remote_glyph}${reset}" ;;
    *)            remote_marker="" ;;
  esac

  text="${description:-${name:-agent}}"

  meta=""
  if [ -n "$start_time" ]; then
    meta+="· $(format_elapsed "$start_time") "
  fi
  if [ "$token_count" -gt 0 ]; then
    meta+="· $(format_tokens "$token_count")"
  fi

  content=$(build_content)

  if [ -n "$columns" ]; then
    local visible
    visible=$(printf '%s' "$content" | sed $'s/\033\\[[0-9;]*m//g')
    if [ "${#visible}" -gt "$columns" ]; then
      local overflow=$(( ${#visible} - columns ))
      local text_max=$(( ${#text} - overflow - 1 ))
      if [ "$text_max" -gt 0 ]; then
        text="${text:0:$text_max}…"
        content=$(build_content)
      fi
    fi
  fi

  jq -c --null-input --arg id "$id" --rawfile content <(printf '%s' "$content") '{id: $id, content: $content}'
}

columns=$(echo "$input" | jq -r '.columns // empty')

echo "$input" | jq -c '.tasks[]' | while IFS= read -r task; do
  render_task "$task" "$columns"
done

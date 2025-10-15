#!/bin/bash

Describe "pull-request/instructions.sh"
  # Helper to create mock transcript
  create_transcript() {
    local marker="$1"
    local temp_file=$(mktemp)
    # Add 10 lines of mock transcript
    for i in {1..10}; do
      if [[ -n "$marker" && $i -eq 5 ]]; then
        echo "{\"content\": \"$marker\"}" >> "$temp_file"
      else
        echo "{\"content\": \"some content $i\"}" >> "$temp_file"
      fi
    done
    echo "$temp_file"
  }

  Describe "gh pr create command"
    It "blocks when guidelines not in recent transcript"
      # Create transcript without guidelines
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "gh pr create --title 'test' --body 'test'" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End

    It "allows when guidelines in recent transcript"
      # Create transcript with guidelines marker
      transcript=$(create_transcript "# Pull Request")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "gh pr create --title 'test' --body 'test'" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 0
      The stdout should be blank
      The stderr should be blank

      rm -f "$transcript"
    End
  End

  Describe "gh pr edit command"
    It "blocks when using --body flag"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "gh pr edit 123 --body 'updated'" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End
  End

  Describe "glab mr create command"
    It "blocks when guidelines not in recent transcript"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "glab mr create --title 'test' --description 'test'" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End
  End

  Describe "glab mr update command"
    It "blocks when using --description flag"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "glab mr update 123 --description 'updated'" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End
  End

  Describe "MCP GitHub tools"
    It "blocks for mcp__github__create_pull_request"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "mcp__github__create_pull_request" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End

    It "blocks for mcp__github__update_pull_request"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "mcp__github__update_pull_request" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 2
      The stderr should include "Pull Request"

      rm -f "$transcript"
    End
  End

  Describe "non-PR commands"
    It "allows non-PR Bash commands"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "Bash" \
        --arg command "git status" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {command: $command},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 0
      The stdout should be blank
      The stderr should be blank

      rm -f "$transcript"
    End

    It "allows other MCP tools"
      transcript=$(create_transcript "")

      input=$(jq -n \
        --arg tool_name "mcp__github__search_issues" \
        --arg transcript_path "$transcript" \
        '{
          tool_name: $tool_name,
          tool_input: {},
          transcript_path: $transcript_path
        }')

      When run sh -c "echo '$input' | ./pull-request/instructions.sh"
      The status should equal 0
      The stdout should be blank
      The stderr should be blank

      rm -f "$transcript"
    End
  End
End

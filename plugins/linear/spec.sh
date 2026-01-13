#!/bin/bash

# ShellSpec tests for Linear default-state hook

Describe 'Linear default-state hook'
  run_hook() {
    local json="$1"
    echo "$json" | ./hooks/default-state.sh
  }

  has_state() {
    [ "$1" = "$(echo "${has_state}" | jq -r '.hookSpecificOutput.updatedInput.state')" ]
  }

  Context 'when state is not set'
    It 'defaults to Backlog when no assignee'
      When run run_hook '{"tool_input":{"title":"Test issue","team":"ENG"}}'
      The status should be success
      The output should satisfy has_state "Backlog"
    End

    It 'defaults to Todo when assignee is set'
      When run run_hook '{"tool_input":{"title":"Test issue","team":"ENG","assignee":"me"}}'
      The status should be success
      The output should satisfy has_state "Todo"
    End

    It 'defaults to Backlog when assignee is empty string'
      When run run_hook '{"tool_input":{"title":"Test issue","team":"ENG","assignee":""}}'
      The status should be success
      The output should satisfy has_state "Backlog"
    End
  End

  Context 'when state is already set'
    It 'does not modify the input'
      When run run_hook '{"tool_input":{"title":"Test issue","team":"ENG","state":"In Progress"}}'
      The status should be success
      The output should be blank
    End

    It 'does not modify even with assignee set'
      When run run_hook '{"tool_input":{"title":"Test issue","team":"ENG","state":"Done","assignee":"me"}}'
      The status should be success
      The output should be blank
    End
  End
End

#!/bin/bash

# ShellSpec tests for GitHub fetch hook

Describe 'GitHub fetch hook'
  # Helper to run hook directly with JSON input
  run_hook() {
    local url="$1"
    # ShellSpec project root is .claude/hooks/, so hook is at github/fetch.sh
    jq -n --arg url "$url" '{tool_name: "WebFetch", tool_input: {url: $url}}' | github/fetch.sh
  }

  # Custom assertion functions for satisfy matcher
  has_decision() {
    [ "$1" = "$(echo "${has_decision}" | jq -r '.hookSpecificOutput.permissionDecision')" ]
  }

  contains_reason() {
    echo "${contains_reason}" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -q "$1"
  }

  has_exact_reason() {
    [ "$1" = "$(echo "${has_exact_reason}" | jq -r '.hookSpecificOutput.permissionDecisionReason')" ]
  }

  Context 'Unit tests - hook logic' unit
    Context 'when URL is not GitHub'
      It 'allows non-GitHub URLs'
        When run run_hook "https://example.com"
        The status should be success
        The output should be blank
      End
    End

    Context 'when fetching GitHub repository root'
      It 'denies and suggests gh repo view for README'
        When run run_hook "https://github.com/bendrucker/deployments"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: gh repo view [<repository>]"
      End

      It 'handles repository URL with trailing slash'
        When run run_hook "https://github.com/bendrucker/deployments/"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: gh repo view [<repository>]"
      End
    End

    Context 'when fetching file content'
      It 'denies and suggests get_file_contents for file content'
        When run run_hook "https://github.com/bendrucker/bendrucker.me/blob/master/astro.config.ts"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: mcp__github__get_file_contents"
      End
    End

    Context 'when fetching directory listing'
      It 'denies and suggests get_file_contents for directory'
        When run run_hook "https://github.com/owner/repo/tree/main/src"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: mcp__github__get_file_contents"
      End

      It 'handles root directory tree'
        When run run_hook "https://github.com/owner/repo/tree/main"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: mcp__github__get_file_contents"
      End
    End

    Context 'when fetching issues or PRs'
      It 'denies and suggests get_issue tool'
        When run run_hook "https://github.com/owner/repo/issues/123"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: mcp__github__get_issue"
      End

      It 'denies and suggests get_pull_request tool'
        When run run_hook "https://github.com/owner/repo/pull/456"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: mcp__github__get_pull_request"
      End
    End

    Context 'when encountering unknown GitHub URL'
      It 'asks user for guidance'
        When run run_hook "https://github.com/explore"
        The status should be success
        The output should satisfy has_decision "ask"
        The output should satisfy contains_reason "Unknown GitHub URL pattern"
      End
    End
  End

  Context 'Integration test - full Claude session' integration
    It 'blocks GitHub repo fetch and shows hook feedback'
      When run sh -c "claude --allowedTools 'WebFetch' --print 'Fetch https://github.com/bendrucker/deployments and show me the hook feedback without running any commands' 2>&1"
      The output should include "gh repo view"
    End
  End
End

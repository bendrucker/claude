#!/bin/bash

# ShellSpec tests for GitLab fetch hook

Describe 'GitLab fetch hook'
  # Helper to run hook directly with JSON input
  run_hook() {
    local url="$1"
    jq -n --arg url "$url" '{tool_name: "WebFetch", tool_input: {url: $url}}' | ./scripts/fetch.sh
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
    Context 'when URL is not GitLab'
      It 'allows non-GitLab URLs'
        When run run_hook "https://example.com"
        The status should be success
        The output should be blank
      End

      It 'allows GitHub URLs'
        When run run_hook "https://github.com/owner/repo"
        The status should be success
        The output should be blank
      End
    End

    Context 'when fetching GitLab project root'
      It 'denies and suggests glab repo view for README'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab repo view [<project>]"
      End

      It 'handles project URL with trailing slash'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab repo view [<project>]"
      End

      It 'handles nested group projects'
        When run run_hook "https://gitlab.com/group/subgroup/project"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab repo view [<project>]"
      End
    End

    Context 'when fetching file content'
      It 'denies and suggests glab api for file content'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab api to fetch file contents"
      End
    End

    Context 'when fetching directory listing'
      It 'denies and suggests glab api for directory'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/tree/main/src"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab api to fetch file contents"
      End

      It 'handles root directory tree'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/tree/main"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab api to fetch file contents"
      End
    End

    Context 'when fetching issues or MRs'
      It 'denies and suggests glab issue view'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/issues/123"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab issue view 123"
      End

      It 'denies and suggests glab mr view'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab mr view 456"
      End
    End

    Context 'when fetching CI/CD resources'
      It 'denies and suggests glab ci view for pipeline'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab ci view 12345"
      End

      It 'denies and suggests glab ci trace for job'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/jobs/67890"
        The status should be success
        The output should satisfy has_decision "deny"
        The output should satisfy has_exact_reason "Use: glab ci trace 67890"
      End
    End

    Context 'when encountering unknown GitLab URL'
      It 'asks user for guidance'
        When run run_hook "https://gitlab.com/gitlab-org/gitlab/-/settings"
        The status should be success
        The output should satisfy has_decision "ask"
        The output should satisfy contains_reason "Unknown GitLab URL pattern"
      End
    End
  End

  Context 'Integration test - full Claude session' integration
    It 'blocks GitLab project fetch and shows hook feedback'
      When run sh -c "claude --allowedTools 'WebFetch' --print 'Fetch https://gitlab.com/gitlab-org/gitlab and show me the hook feedback without running any commands' 2>&1"
      The output should include "glab repo view"
    End
  End
End

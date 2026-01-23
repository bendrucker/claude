#!/usr/bin/env shellspec

Describe "block-default-branch-commit hook"
  setup() {
    # Create a temporary git repo for testing
    test_repo=$(mktemp -d)
    cd "$test_repo"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    touch README.md
    git add README.md
    git commit -q -m "Initial commit"
    # Set up origin/HEAD to point to main
    git symbolic-ref refs/remotes/origin/HEAD refs/heads/main 2>/dev/null || true
  }

  cleanup() {
    rm -rf "$test_repo"
  }

  BeforeEach setup
  AfterEach cleanup

  Describe "non-commit commands"
    It "allows git status"
      input=$(jq -n '{tool_input: {command: "git status"}}')
      cd "$test_repo"
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End

    It "allows git push"
      input=$(jq -n '{tool_input: {command: "git push origin main"}}')
      cd "$test_repo"
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End

    It "allows non-git commands"
      input=$(jq -n '{tool_input: {command: "ls -la"}}')
      cd "$test_repo"
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End
  End

  Describe "commit on topic branch"
    It "allows commit on feature branch"
      cd "$test_repo"
      git checkout -q -b feature-branch
      input=$(jq -n '{tool_input: {command: "git commit -m \"test\""}}')
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End
  End

  Describe "commit on default branch"
    It "blocks commit on main branch"
      cd "$test_repo"
      git symbolic-ref refs/remotes/origin/HEAD refs/heads/main
      input=$(jq -n '{tool_input: {command: "git commit -m \"test\""}}')
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should include '"permissionDecision":"deny"'
      The output should include "Cannot commit directly to main"
      The output should include "Create a topic branch first"
    End

    It "blocks commit with additional flags"
      cd "$test_repo"
      git symbolic-ref refs/remotes/origin/HEAD refs/heads/main
      input=$(jq -n '{tool_input: {command: "git commit -a -m \"test\""}}')
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should include '"permissionDecision":"deny"'
    End
  End

  Describe "detached HEAD"
    It "allows commit in detached HEAD state"
      cd "$test_repo"
      git checkout -q --detach HEAD
      input=$(jq -n '{tool_input: {command: "git commit -m \"test\""}}')
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End
  End

  Describe "outside git repo"
    It "allows commit outside git repo"
      outside_dir=$(mktemp -d)
      cd "$outside_dir"
      input=$(jq -n '{tool_input: {command: "git commit -m \"test\""}}')
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
      rm -rf "$outside_dir"
    End
  End

  Describe "empty input"
    It "handles empty input gracefully"
      input='{}'
      cd "$test_repo"
      When run sh -c "echo '$input' | $OLDPWD/scripts/block-default-branch-commit.sh"
      The status should be success
      The output should be blank
    End
  End
End

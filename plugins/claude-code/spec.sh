#!/usr/bin/env shellspec

Describe "check-namespace hook"
  script="skills/skills/scripts/check-namespace.sh"

  setup() {
    test_dir=$(mktemp -d)
    mkdir -p "$test_dir/plugins/gitlab/skills/ci"
    mkdir -p "$test_dir/plugins/gitlab/agents"
    mkdir -p "$test_dir/plugins/gitlab/commands"
    mkdir -p "$test_dir/plugins/claude-code/skills/hooks"
  }

  cleanup() {
    rm -rf "$test_dir"
  }

  BeforeEach setup
  AfterEach cleanup

  Describe "skill names"
    It "warns when skill name stutters with plugin (prefix)"
      echo "name: gitlab-ci" > "$test_dir/plugins/gitlab/skills/ci/SKILL.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/skills/ci/SKILL.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should include "Warning"
      The stderr should include "stutters"
      The stderr should include "gitlab:gitlab-ci"
    End

    It "warns when skill name equals plugin name"
      echo "name: gitlab" > "$test_dir/plugins/gitlab/skills/ci/SKILL.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/skills/ci/SKILL.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should include "Warning"
      The stderr should include "stutters"
    End

    It "allows properly named skills"
      echo "name: ci" > "$test_dir/plugins/gitlab/skills/ci/SKILL.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/skills/ci/SKILL.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should be blank
    End

    It "handles hyphenated plugin names"
      echo "name: claude-code-helper" > "$test_dir/plugins/claude-code/skills/hooks/SKILL.md"
      input=$(jq -n --arg path "$test_dir/plugins/claude-code/skills/hooks/SKILL.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should include "Warning"
    End
  End

  Describe "agent names"
    It "warns when agent filename stutters"
      echo "---" > "$test_dir/plugins/gitlab/agents/gitlab-reviewer.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/agents/gitlab-reviewer.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should include "Warning"
      The stderr should include "agent name"
    End

    It "allows properly named agents"
      echo "---" > "$test_dir/plugins/gitlab/agents/reviewer.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/agents/reviewer.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should be blank
    End
  End

  Describe "command names"
    It "warns when command filename stutters"
      echo "---" > "$test_dir/plugins/gitlab/commands/gitlab-merge.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/commands/gitlab-merge.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should include "Warning"
      The stderr should include "command name"
    End

    It "allows properly named commands"
      echo "---" > "$test_dir/plugins/gitlab/commands/merge.md"
      input=$(jq -n --arg path "$test_dir/plugins/gitlab/commands/merge.md" '{tool_input: {file_path: $path}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should be blank
    End
  End

  Describe "non-plugin paths"
    It "ignores files outside plugins directory"
      input=$(jq -n '{tool_input: {file_path: "/Users/ben/src/project/SKILL.md"}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should be blank
    End

    It "handles missing file_path"
      input=$(jq -n '{tool_input: {}}')
      When run sh -c "echo '$input' | $script"
      The status should be success
      The stderr should be blank
    End
  End
End

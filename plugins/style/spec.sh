#!/bin/bash

# ShellSpec tests for style anti-numbering hook

Describe 'Anti-numbering hook'
  run_hook() {
    local mode="$1"
    local tool="$2"
    local content="$3"
    local file_path="${4:-test.md}"

    if [[ "$tool" == "Write" ]]; then
      jq -n \
        --arg content "$content" \
        --arg path "$file_path" \
        '{tool_name: "Write", tool_input: {file_path: $path, content: $content}}' \
        | ./hooks/anti-numbering.sh "$mode"
    else
      jq -n \
        --arg content "$content" \
        --arg path "$file_path" \
        '{tool_name: "Edit", tool_input: {file_path: $path, new_string: $content, old_string: "placeholder"}}' \
        | ./hooks/anti-numbering.sh "$mode"
    fi
  }

  has_decision() {
    [ "$1" = "$(echo "${has_decision}" | jq -r '.hookSpecificOutput.permissionDecision')" ]
  }

  contains_reason() {
    echo "${contains_reason}" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -q "$1"
  }

  Context 'Numbered markdown headers'
    It 'detects "# 1. Something" pattern'
      When run run_hook "write" "Write" "# 1. Introduction
Some content here"
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Numbered headers"
    End

    It 'detects "## Step 2:" pattern'
      When run run_hook "write" "Write" "## Step 2: Configuration
Configure the system"
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Numbered headers"
    End

    It 'detects "### Phase 3" pattern'
      When run run_hook "write" "Write" "### Phase 3
Implementation details"
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Numbered headers"
    End

    It 'allows headers without numbers'
      When run run_hook "write" "Write" "# Introduction
## Configuration
### Implementation"
      The status should be success
      The output should be blank
    End
  End

  Context 'Step/Phase comments in code'
    It 'detects "// Step 1:" in code'
      When run run_hook "write" "Write" "// Step 1: Initialize
func init() {}" "main.go"
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Step/Phase comments"
    End

    It 'detects "# Phase 2" in Python'
      When run run_hook "write" "Write" "# Phase 2 - Processing
def process():" "script.py"
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Step/Phase comments"
    End

    It 'allows regular comments without step numbers'
      When run run_hook "write" "Write" "// Initialize the system
func init() {}" "main.go"
      The status should be success
      The output should be blank
    End
  End

  Context 'Write vs Edit mode'
    It 'blocks Write tool with deny'
      When run run_hook "write" "Write" "# 1. First Step"
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'asks for Edit tool instead of deny'
      When run run_hook "edit" "Edit" "# 1. First Step"
      The status should be success
      The output should satisfy has_decision "ask"
    End
  End

  Context 'File type filtering'
    It 'checks markdown files'
      When run run_hook "write" "Write" "# 1. First" "doc.md"
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'checks code files'
      When run run_hook "write" "Write" "// Step 1: Init" "main.go"
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'skips JSON files'
      When run run_hook "write" "Write" '{"step1": "value"}' "config.json"
      The status should be success
      The output should be blank
    End

    It 'skips YAML files'
      When run run_hook "write" "Write" "step1: value" "config.yaml"
      The status should be success
      The output should be blank
    End
  End

  Context 'Legitimate uses'
    It 'allows numbered list items in markdown body'
      When run run_hook "write" "Write" "# Installation

1. Clone the repository
2. Run npm install
3. Start the server"
      The status should be success
      The output should be blank
    End

    It 'allows version numbers'
      When run run_hook "write" "Write" "# Version 2.0 Release Notes" "CHANGELOG.md"
      The status should be success
      The output should be blank
    End
  End
End

#!/bin/bash

# ShellSpec tests for style numbering hook (ast-grep based)
# Requires: sg (ast-grep) to be installed

Describe 'Numbering hook'
  # Check if sg is NOT available (Skip if returns true = skip)
  sg_not_available() {
    ! command -v sg &>/dev/null
  }
  Skip if 'sg not installed' sg_not_available

  run_hook() {
    local mode="$1"
    local tool="$2"
    local file_path="$3"
    local content="$4"

    if [[ "$tool" == "Write" ]]; then
      printf '%s' "{\"tool_name\": \"Write\", \"tool_input\": {\"file_path\": \"$file_path\", \"content\": \"$content\"}}" \
        | ./hooks/numbering.sh "$mode"
    else
      printf '%s' "{\"tool_name\": \"Edit\", \"tool_input\": {\"file_path\": \"$file_path\", \"new_string\": \"$content\"}}" \
        | ./hooks/numbering.sh "$mode"
    fi
  }

  has_decision() {
    [ "$1" = "$(echo "${has_decision}" | jq -r '.hookSpecificOutput.permissionDecision')" ]
  }

  contains_reason() {
    echo "${contains_reason}" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -q "$1"
  }

  Context 'Go numbered identifiers'
    It 'detects func step1()'
      When run run_hook "write" "Write" "main.go" 'package main\nfunc step1() { fmt.Println(\"test\") }'
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "step1"
    End

    It 'detects func phase2()'
      When run run_hook "write" "Write" "main.go" 'package main\nfunc phase2() {}'
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "phase2"
    End

    It 'allows descriptive function names'
      When run run_hook "write" "Write" "main.go" 'package main\nfunc processItems() { fmt.Println(\"test\") }'
      The status should be success
      The output should be blank
    End
  End

  Context 'JavaScript numbered identifiers'
    It 'detects function step1()'
      When run run_hook "write" "Write" "app.js" 'function step1() { console.log(\"test\"); }'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'detects const part3 = ...'
      When run run_hook "write" "Write" "app.js" 'const part3 = () => {};'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'allows descriptive names'
      When run run_hook "write" "Write" "app.js" 'function handleSubmit() { console.log(\"test\"); }'
      The status should be success
      The output should be blank
    End
  End

  Context 'Python numbered identifiers'
    It 'detects def step1()'
      When run run_hook "write" "Write" "script.py" 'def step1():\n    pass'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'detects class Phase2'
      When run run_hook "write" "Write" "script.py" 'class Phase2:\n    pass'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'allows descriptive names'
      When run run_hook "write" "Write" "script.py" 'def process_items():\n    pass'
      The status should be success
      The output should be blank
    End
  End

  Context 'Write vs Edit mode'
    It 'blocks Write tool with deny'
      When run run_hook "write" "Write" "main.go" 'package main\nfunc step1() {}'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'asks for Edit tool instead of deny'
      When run run_hook "edit" "Edit" "main.go" 'func step1() {}'
      The status should be success
      The output should satisfy has_decision "ask"
    End
  End

  Context 'File type filtering'
    It 'checks Go files'
      When run run_hook "write" "Write" "main.go" 'func step1() {}'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'checks TypeScript files'
      When run run_hook "write" "Write" "app.ts" 'function step1() {}'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'skips unsupported file types (JSON)'
      When run run_hook "write" "Write" "config.json" '{\"step1\": \"value\"}'
      The status should be success
      The output should be blank
    End

  End

  Context 'Markdown numbered headings'
    It 'detects "# 1. Introduction"'
      When run run_hook "write" "Write" "README.md" '# 1. Introduction'
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "1. Introduction"
    End

    It 'detects "## Step 2: Setup"'
      When run run_hook "write" "Write" "docs.md" '## Step 2: Setup'
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Step 2"
    End

    It 'detects "### Phase 3"'
      When run run_hook "write" "Write" "guide.markdown" '### Phase 3'
      The status should be success
      The output should satisfy has_decision "deny"
      The output should satisfy contains_reason "Phase 3"
    End

    It 'allows descriptive headings'
      When run run_hook "write" "Write" "README.md" '# Introduction'
      The status should be success
      The output should be blank
    End

    It 'allows headings with numbers mid-text'
      When run run_hook "write" "Write" "README.md" '# Using OAuth2 for Authentication'
      The status should be success
      The output should be blank
    End
  End

  Context 'Test files are NOT excluded'
    It 'checks *_test.go files'
      When run run_hook "write" "Write" "main_test.go" 'func step1() {}'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'checks *.spec.ts files'
      When run run_hook "write" "Write" "app.spec.ts" 'function step1() {}'
      The status should be success
      The output should satisfy has_decision "deny"
    End

    It 'checks test_*.py files'
      When run run_hook "write" "Write" "test_utils.py" 'def step1():\n    pass'
      The status should be success
      The output should satisfy has_decision "deny"
    End
  End
End

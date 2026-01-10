#!/bin/bash

Describe "newline hooks"
  # Custom matcher for file with trailing newline
  assert_has_trailing_newline() {
    file_path=${assert_has_trailing_newline:?}
    test -f "$file_path" && test -s "$file_path" && test "$(tail -c1 "$file_path" | wc -l)" -eq 1
  }

  assert_has_no_trailing_newline() {
    file_path=${assert_has_no_trailing_newline:?}
    test -f "$file_path" && test -s "$file_path" && test "$(tail -c1 "$file_path" | wc -l)" -eq 0
  }

  BeforeAll 'mkdir -p output && rm -rf output/* 2>/dev/null || true'
  AfterAll 'rm -rf output/* 2>/dev/null || true'

  Describe "check.sh unit tests" unit
    It "stores empty state for empty file"
      test_file="output/empty.txt"
      touch "$test_file"
      
      # Create JSON input
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/check.sh && ./scripts/state.sh get newline '$abs_path'"
      The status should be success
      The output should equal ""
    End

    It "stores '1' for file with trailing newline"
      test_file="output/with_newline.txt"
      echo "content" > "$test_file"
      
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/check.sh && ./scripts/state.sh get newline '$abs_path'"
      The status should be success
      The output should equal "1"
    End

    It "stores empty string for file without trailing newline"
      test_file="output/no_newline.txt"
      echo -n "content" > "$test_file"
      
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/check.sh && ./scripts/state.sh get newline '$abs_path'"
      The status should be success
      The output should equal ""
    End

    It "exits with error for missing file_path"
      input='{"tool_input": {}}'
      
      When run sh -c "echo '$input' | ./scripts/check.sh"
      The status should be failure
      The error should include "No file_path found"
    End
  End

  Describe "ensure.sh unit tests" unit
    It "adds newline to file without one"
      test_file="output/no_newline.txt"
      echo -n "content" > "$test_file"
      
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/ensure.sh"
      The status should be success
      The output should include "Adding trailing newline"
      The path "$abs_path" should be exist
      The path "$abs_path" should satisfy assert_has_trailing_newline
    End

    It "preserves existing newline"
      test_file="output/with_newline.txt"
      echo "content" > "$test_file"
      
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/ensure.sh"
      The status should be success
      The output should include "File already has trailing newline"
      The path "$abs_path" should satisfy assert_has_trailing_newline
    End

    It "skips empty files"
      test_file="output/empty.txt"
      touch "$test_file"
      
      abs_path=$(realpath "$test_file")
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/ensure.sh"
      The status should be success
      The output should include "File is empty, skipping"
      The path "$abs_path" should be empty file
    End

    It "exits with error for missing file_path"
      input='{"tool_input": {}}'
      
      When run sh -c "echo '$input' | ./scripts/ensure.sh"
      The status should be failure
      The output should include "Extracted file_path: null"
      The error should include "No file_path found"
    End
  End

  Describe "preserve.sh unit tests" unit
    It "adds newline when original had one"
      test_file="output/preserve_with.txt"
      echo -n "new content" > "$test_file"
      abs_path=$(realpath "$test_file")
      ./scripts/state.sh set newline "$abs_path" "1"
      
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh"
      The status should be success
      The path "$abs_path" should satisfy assert_has_trailing_newline
    End

    It "removes newline when original had none"
      test_file="output/preserve_without.txt"
      echo "new content" > "$test_file"
      abs_path=$(realpath "$test_file")
      ./scripts/state.sh set newline "$abs_path" ""
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh"
      The status should be success
      The path "$abs_path" should satisfy assert_has_no_trailing_newline
    End

    It "preserves existing newline when original had one"
      test_file="output/preserve_keep.txt"
      echo "content" > "$test_file"
      abs_path=$(realpath "$test_file")
      ./scripts/state.sh set newline "$abs_path" "1"
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh"
      The status should be success
      The path "$abs_path" should satisfy assert_has_trailing_newline
    End

    It "skips empty files"
      test_file="output/empty_preserve.txt"
      touch "$test_file"
      abs_path=$(realpath "$test_file")
      ./scripts/state.sh set newline "$abs_path" "1"
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh"
      The status should be success
      The path "$abs_path" should be empty file
    End

    It "cleans up state after processing"
      test_file="output/cleanup.txt"
      echo "content" > "$test_file"
      abs_path=$(realpath "$test_file")
      ./scripts/state.sh set newline "$abs_path" "1"
      input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh && ./scripts/state.sh get newline '$abs_path'"
      The status should be success
      The output should equal ""
    End

    It "exits with error for missing file_path"
      input='{"tool_input": {}}'
      
      When run sh -c "echo '$input' | ./scripts/preserve.sh"
      The status should be failure
      The error should include "No file_path found"
    End
  End

  Describe "Edit tool integration test" integration
    It "preserves trailing newline when editing file"
      test_file="output/integration_test.txt"
      echo "original content" > "$test_file"
      
      When run sh -c "claude --allowedTools 'Read,Edit' --print \"Edit $test_file and replace 'original content' with 'modified content'\" >/dev/null 2>&1 && [ \$(tail -c1 '$test_file' | wc -l) -eq 1 ]"
      The status should be success
    End
  End
End

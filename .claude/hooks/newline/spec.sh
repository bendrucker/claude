#!/bin/bash

Describe "newline hooks"
  # Helper function to check if a file has a trailing newline
  file_has_trailing_newline() {
    [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 1 ]
  }

  # Helper function to check if a file has no trailing newline
  file_has_no_trailing_newline() {
    [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 0 ]
  }

  # Setup and cleanup output directory
  BeforeAll 'mkdir -p output && rm -rf output/* 2>/dev/null || true'
  AfterAll 'rm -rf output/* 2>/dev/null || true'

  Describe "Write tool"
    It "adds trailing newline to files"
      # Use absolute path to avoid scoping issues
      test_file="$PWD/output/test_write.txt"
      
      # Run Claude and verify file creation with trailing newline
      When run sh -c "claude --allowedTools 'Read,Write' --print \"Write 'test content' to $test_file\" >/dev/null 2>&1 && test -f '$test_file' && [ \$(tail -c1 '$test_file' | wc -l) -eq 1 ]"
      The status should be success
    End
  End

  Describe "Edit tool with existing newline"
    It "preserves trailing newline when editing"
      test_file="$PWD/output/test_edit_with_newline.txt"
      
      # Create file with trailing newline, edit it, and verify newline is preserved
      When run sh -c "echo 'original content' > '$test_file' && claude --allowedTools 'Read,Edit' --print \"Edit $test_file and replace 'original content' with 'original content\\nappended text'\" >/dev/null 2>&1 && [ \$(tail -c1 '$test_file' | wc -l) -eq 1 ]"
      The status should be success
    End
  End

  Describe "Edit tool without existing newline"
    It "preserves no-newline state when editing"
      test_file="output/test_edit_no_newline.txt"
      
      # Create file without trailing newline, edit it, and verify no-newline state is preserved
      When run sh -c "echo -n 'original content' > '$test_file' && claude --allowedTools 'Read,Edit' --print \"Edit $test_file and replace 'original content' with 'original content appended'\" >/dev/null 2>&1 && [ \$(tail -c1 '$test_file' | wc -l) -eq 0 ]"
      The status should be success
    End
  End
End

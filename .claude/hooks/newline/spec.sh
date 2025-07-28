#!/bin/bash

Describe "newline hooks"
  # Test helpers
  has_trailing_newline() {
    [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 1 ]
  }

  has_no_trailing_newline() {
    [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 0 ]
  }

  is_empty_file() {
    [ -f "$1" ] && [ ! -s "$1" ]
  }

  Describe "Write tool"
    setup() {
      TEST_DIR=$(mktemp -d)
      TEST_FILE="$TEST_DIR/test.txt"
    }
    
    cleanup() {
      [ -d "$TEST_DIR" ] && rm -rf "$TEST_DIR"
    }
    
    Before 'setup'
    After 'cleanup'
    
    It "adds trailing newline to files"
      When run claude --debug --allowedTools "Read,Write" --print "Write 'test content' to $TEST_FILE"
      The status should be success
      The file "$TEST_FILE" should satisfy has_trailing_newline
    End

  End

  Describe "Edit tool with existing newline"
    It "preserves trailing newline when editing"
      test_file=$(mktemp)
      echo "original content" > "$test_file"
      
      # Verify setup
      The file "$test_file" should satisfy has_trailing_newline
      
      When run claude --debug --allowedTools "Read,Edit" --print "Edit $test_file and replace 'original content' with 'original content\nappended text'"
      The status should be success  
      The file "$test_file" should satisfy has_trailing_newline
      
      After run rm -f "$test_file"
    End
  End

  Describe "Edit tool without existing newline"
    It "preserves no-newline state when editing"
      test_file=$(mktemp)
      echo -n "original content" > "$test_file"
      
      # Verify setup
      The file "$test_file" should satisfy has_no_trailing_newline
      
      When run claude --debug --allowedTools "Read,Edit" --print "Edit $test_file and replace 'original content' with 'original content appended'"
      The status should be success
      The file "$test_file" should satisfy has_no_trailing_newline
      
      After run rm -f "$test_file"
    End
  End
End
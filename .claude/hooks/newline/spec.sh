#!/bin/bash

Describe "newline hooks"
  # Test helpers
  has_trailing_newline() {
    echo "DEBUG: Checking file: $1" >&2
    echo "DEBUG: File exists: $([ -f "$1" ] && echo yes || echo no)" >&2
    echo "DEBUG: File not empty: $([ -s "$1" ] && echo yes || echo no)" >&2
    if [ -f "$1" ] && [ -s "$1" ]; then
      tail_result=$(tail -c1 "$1" | wc -l)
      echo "DEBUG: tail -c1 | wc -l result: '$tail_result'" >&2
      [ "$tail_result" -eq 1 ]
    else
      false
    fi
  }

  has_no_trailing_newline() {
    [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 0 ]
  }

  is_empty_file() {
    [ -f "$1" ] && [ ! -s "$1" ]
  }

  Describe "Write tool"
    It "adds trailing newline to files"
      test_dir=$(mktemp -d)
      test_file="$test_dir/test.txt"
      
      # Write the file and verify hook adds newline
      When run sh -c "claude --allowedTools 'Read,Write' --print \"Write 'test content' to $test_file\" >/dev/null 2>&1 && [ -f \"$test_file\" ] && [ \$(tail -c1 \"$test_file\" | wc -l) -eq 1 ]"
      The status should be success
      
      # Cleanup
      rm -rf "$test_dir"
    End

  End

  Describe "Edit tool with existing newline"
    setup_edit_test() {
      EDIT_TEST_FILE=$(mktemp)
      echo "original content" > "$EDIT_TEST_FILE"
    }
    
    cleanup_edit_test() {
      [ -f "$EDIT_TEST_FILE" ] && rm -f "$EDIT_TEST_FILE"
    }
    
    Before 'setup_edit_test'
    After 'cleanup_edit_test'
    
    It "preserves trailing newline when editing"
      # Verify setup
      The file "$EDIT_TEST_FILE" should satisfy has_trailing_newline
      
      When run claude --debug --allowedTools "Read,Edit" --print "Edit $EDIT_TEST_FILE and replace 'original content' with 'original content\\nappended text'"
      The status should be success  
      The file "$EDIT_TEST_FILE" should satisfy has_trailing_newline
    End
  End

  Describe "Edit tool without existing newline"
    setup_edit_no_newline_test() {
      EDIT_NO_NEWLINE_TEST_FILE=$(mktemp)
      echo -n "original content" > "$EDIT_NO_NEWLINE_TEST_FILE"
    }
    
    cleanup_edit_no_newline_test() {
      [ -f "$EDIT_NO_NEWLINE_TEST_FILE" ] && rm -f "$EDIT_NO_NEWLINE_TEST_FILE"
    }
    
    Before 'setup_edit_no_newline_test'
    After 'cleanup_edit_no_newline_test'
    
    It "preserves no-newline state when editing"
      # Verify setup
      The file "$EDIT_NO_NEWLINE_TEST_FILE" should satisfy has_no_trailing_newline
      
      When run claude --debug --allowedTools "Read,Edit" --print "Edit $EDIT_NO_NEWLINE_TEST_FILE and replace 'original content' with 'original content appended'"
      The status should be success
      The file "$EDIT_NO_NEWLINE_TEST_FILE" should satisfy has_no_trailing_newline
    End
  End
End
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
    It "adds trailing newline to files"
      test_file=$(mktemp)
      permissions="Read(/$test_file),Write(/$test_file)"
      
      When run claude --allowedTools "$permissions" --print "Write 'test content' to $test_file"
      The status should be success
      The file "$test_file" should satisfy has_trailing_newline
      rm -f "$test_file"
    End

    It "preserves trailing newline for empty writes"  
      test_file=$(mktemp)
      permissions="Read(/$test_file),Write(/$test_file)"
      
      When run claude --allowedTools "$permissions" --print "Write empty content to $test_file"
      The status should be success
      The file "$test_file" should satisfy is_empty_file
      rm -f "$test_file"
    End
  End

  Describe "Edit tool with existing newline"
    It "preserves trailing newline when editing"
      test_file=$(mktemp)
      echo "original content" > "$test_file"
      permissions="Read(/$test_file),Edit(/$test_file)"
      
      # Verify setup
      The file "$test_file" should satisfy has_trailing_newline
      
      When run claude --allowedTools "$permissions" --print "Edit $test_file and replace 'original content' with 'original content\nappended text'"
      The status should be success  
      The file "$test_file" should satisfy has_trailing_newline
      rm -f "$test_file"
    End
  End

  Describe "Edit tool without existing newline"
    It "preserves no-newline state when editing"
      test_file=$(mktemp)
      echo -n "original content" > "$test_file"
      permissions="Read(/$test_file),Edit(/$test_file)"
      
      # Verify setup
      The file "$test_file" should satisfy has_no_trailing_newline
      
      When run claude --allowedTools "$permissions" --print "Edit $test_file and replace 'original content' with 'original content appended'"
      The status should be success
      The file "$test_file" should satisfy has_no_trailing_newline
      rm -f "$test_file"
    End
  End
End
#!/bin/bash

cd .claude/hooks/newline

# Test helper functions
has_trailing_newline() {
  [ -f "$1" ] && [ -s "$1" ] && [ "$(tail -c1 "$1" | wc -l)" -eq 1 ]
}

# Create test directory and file
TEST_DIR=$(mktemp -d)
TEST_FILE="$TEST_DIR/test.txt"

echo "Test directory: $TEST_DIR"
echo "Test file: $TEST_FILE"

# Run Claude command
echo "Running Claude command..."
claude --allowedTools "Read,Write" --print "Write 'test content' to $TEST_FILE"

echo "Claude command completed with exit code: $?"

# Check if file exists
if [ -f "$TEST_FILE" ]; then
    echo "✓ File exists"
    echo "File contents (hexdump):"
    hexdump -C "$TEST_FILE"
    
    echo "File size: $(wc -c < "$TEST_FILE") bytes"
    echo "tail -c1 | wc -l result: $(tail -c1 "$TEST_FILE" | wc -l)"
    
    if has_trailing_newline "$TEST_FILE"; then
        echo "✓ has_trailing_newline: PASS"
    else
        echo "✗ has_trailing_newline: FAIL"
    fi
else
    echo "✗ File does not exist"
fi

# Cleanup
rm -rf "$TEST_DIR"

#!/bin/bash

# Test all hooks using ShellSpec with parallel execution
cd "$(dirname "$0")"
command -v shellspec >/dev/null || { echo "ShellSpec required"; exit 1; }
exec shellspec --format documentation --jobs 3
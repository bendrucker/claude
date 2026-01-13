# newline

POSIX-compliant trailing newline management for files.

## Purpose

This plugin ensures all edited files maintain proper POSIX-compliant trailing newlines. Per the POSIX standard, text files should end with a newline character.

## Hooks

- **PreToolUse (Edit|MultiEdit)**: Checks if files have trailing newlines before edits and stores state
- **PostToolUse (Write)**: Ensures newly written files have trailing newlines
- **PostToolUse (Edit|MultiEdit)**: Preserves trailing newline state after edits

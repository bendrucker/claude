# Claude Code Hooks

This directory contains Claude Code hooks that automate behaviors during tool usage.

## Structure

```
hooks/
├── CLAUDE.md           # This documentation
├── .shellspec          # ShellSpec configuration
├── test.sh            # Run all hook tests
├── state.sh           # General state management utility
└── <topic>/            # Topic-based directories (e.g., newline, github)
    ├── <action>.sh     # Hook scripts named by action (e.g., fetch.sh, check.sh)
    └── spec.sh         # ShellSpec tests
```

### Hook Naming Convention

- Group hooks by topic/domain (e.g., `newline/`, `github/`)
- Name scripts by their specific action with `.sh` extension
- Use descriptive names that indicate the hook's purpose

## Current Hooks

### Newline Hooks (`newline/`)

Ensures POSIX compliance by managing trailing newlines in files:

- **Write tool**: Always adds trailing newline
- **Edit/MultiEdit tools**: Preserves original newline state
- **State tracking**: Uses temporary files to communicate between pre/post hooks

**Scripts:**
- `check.sh`: PreToolUse hook to record original newline state
- `preserve.sh`: PostToolUse hook for Edit tools to maintain original state  
- `ensure.sh`: PostToolUse hook for Write tool to always add newline

## Testing

### Requirements

1. **ShellSpec**: Install with `curl -fsSL https://git.io/shellspec | sh`
2. **Claude Code**: Working Claude installation

### Running Tests

```bash
# Run all hook tests
./test.sh

# Run specific hook tests
cd newline && shellspec spec.sh

# Run single test (faster iteration)
cd newline && shellspec spec.sh --example "adds trailing newline"

# Dry run to see test structure
cd newline && shellspec spec.sh --dry-run
```

### Test Structure

Tests use ShellSpec with these patterns:

```bash
test_file=$(mktemp)
permissions="Read(/$test_file),Write(/$test_file)"
When run claude --allowedTools "$permissions" --print "Write 'content' to $test_file"
The status should be success
The file "$test_file" should satisfy has_trailing_newline
```

**Key points:**
- Uses `--allowedTools` with comma-separated permissions in single argument
- Format: `"Read(/$absolute_path),Write(/$absolute_path)"` results in `//` prefix
- Write tool requires both Read and Write permissions
- Use `mktemp` for reliable temporary file paths
- Tests are slow since they invoke full Claude Code sessions
- Use line number targeting (`shellspec spec.sh:18`) for fast iteration
- Helper functions (`has_trailing_newline`, etc.) are inlined in each spec file

### Test Development

When developing new hook tests:

1. Create `<hook>/spec.sh` with ShellSpec format
2. Include helper functions inline (no shared spec_helper)
3. **Write comprehensive unit tests** that test hooks directly without invoking Claude
4. **Include at least one integration test** using `claude --print` for the positive case
5. Use `claude --allowedTools` to grant necessary permissions for integration tests
6. Test with `shellspec spec.sh:LINE_NUMBER` for fast iteration (e.g., `shellspec spec.sh:18`)
7. Verify all tests pass with `shellspec spec.sh`

**Testing Strategy**:
- **Unit tests**: Test hook scripts directly by piping JSON input and checking outputs/side effects
- **Integration tests**: Use `claude --print` to test end-to-end behavior with actual Claude invocation
- **Coverage**: Aim for full unit test coverage of all code paths and edge cases
- **Performance**: Unit tests are fast, use one integration test for the main positive case

**Example unit test pattern**:
```bash
# Test hook script directly with JSON input and custom matcher
input=$(jq -n --arg file_path "$abs_path" '{tool_input: {file_path: $file_path}}')
When run sh -c "echo '$input' | ./newline/ensure.sh"
The status should be success
The path "$abs_path" should satisfy assert_has_trailing_newline
```

**Custom file matchers**:
```bash
# Custom matcher functions use variable pattern
assert_has_trailing_newline() {
  file_path=${assert_has_trailing_newline:?}
  test -f "$file_path" && test -s "$file_path" && test "$(tail -c1 "$file_path" | wc -l)" -eq 1
}

# Use with The path syntax (not The file)
The path "$abs_path" should satisfy assert_has_trailing_newline
```

**Example integration test pattern**:
```bash
# Test full Claude invocation (use sparingly)
When run sh -c "claude --allowedTools 'Read,Edit' --print \"Edit $test_file...\" >/dev/null 2>&1"
The status should be success
```

**Current Status**: All tests pass successfully. The test framework uses ShellSpec with parallel execution (`--jobs 3`) and proper IAM permission syntax.

**Working Permission Syntax**:
- Format: `--allowedTools "Read(/$file_path),Write(/$file_path)"` 
- Uses comma-separated permissions in single argument
- Requires exactly 2 leading slashes for absolute paths (`//` prefix)
- Both Read and Write permissions needed for Write tool operations
- Uses `mktemp` for reliable temporary file paths

## Adding New Hooks

1. Create directory: `mkdir hooks/<topic>`
2. Add hook scripts named by action (e.g., `fetch.sh`, `check.sh`)
3. Update `settings.json` to reference new hooks
4. Create `<topic>/spec.sh` with ShellSpec tests
5. Test with `./test.sh` or `shellspec <topic>/spec.sh`
6. No need to run `./install.sh` - the `.claude/` directory is already symlinked

**Important**: Always write and run ShellSpec tests for new hooks. Never test hooks manually.

## State Management

Use `state.sh` for inter-hook communication:

```bash
# Store state
./state.sh set <type> <key> <value>

# Retrieve state  
value=$(./state.sh get <type> <key>)
```

- `<type>`: State category (e.g., "newline")
- `<key>`: Unique identifier (e.g., file path)
- `<value>`: State value
- Default state is empty string for compatibility with empty files
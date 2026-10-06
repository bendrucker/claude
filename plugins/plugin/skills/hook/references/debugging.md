# Debugging Hooks

Diagnose hook failures when you see errors like "N out of M hooks run".

## Viewing Hook Output

Hook script output (stdout/stderr) is silent by default. To see it:

| Method | When to use |
|--------|-------------|
| `ctrl+o` (verbose mode) | Real-time output during session |
| `claude --debug` | Detailed logs written to disk |
| `/hooks` | Verify hooks are registered |

With `--debug`, hook execution details appear in `~/.claude/debug/latest`:

```
[DEBUG] Executing hook command: <command> with timeout 60000ms
[DEBUG] Hook command completed with status 0: <stdout>
```

## Debug Log Patterns

The debug log (`~/.claude/debug/latest`) contains Claude Code's internal hook processing:

| Pattern | Meaning |
|---------|---------|
| `Loaded hooks from standard location for plugin X` | Hook registered |
| `Getting matching hook commands for PostToolUse with query: Write` | Matching attempt |
| `Matched N unique hooks for query "X"` | Hooks that matched |
| `Hooks: Parsed initial response: {...}` | Hook output parsed |
| `Hook output does not start with {` | Non-JSON output (treated as text) |
| `[ERROR]` | Actual errors |

### Diagnostic Commands

```bash
# Find hook registrations
grep "Loaded hooks from" ~/.claude/debug/latest

# Find matches for a specific tool
grep "matching hook commands.*Write" ~/.claude/debug/latest

# Find hook script output
grep "Hook command completed" ~/.claude/debug/latest

# Find errors
grep -E "\[ERROR\]" ~/.claude/debug/latest | grep -i hook
```

## Configuration Locations

- User: `~/.claude/settings.json`
- Project: `.claude/settings.json`
- Plugin: `~/.claude/plugins/cache/<org>/<plugin>/<version>/hooks/hooks.json`

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Hook not triggering | Matcher doesn't match tool name | Check regex pattern with `/hooks` |
| Non-JSON output treated as text | Script outputs plain text | Return JSON with `hookSpecificOutput` |
| Hook runs but no effect | Missing `hookEventName` in output | Add `hookEventName: "PostToolUse"` |
| Script not found | Bad path or `CLAUDE_PLUGIN_ROOT` | Use absolute path or verify env var |
| Can't see script output | Output silent by default | Use `ctrl+o` or `--debug` |

# Claude Hooks

[Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) that customize behavior during code generation and tool usage.

## Patterns

All hooks follow the same pattern using typed event classes from [`claude-hooks`](https://pypi.org/project/claude-hooks/):

## Testing

Each `*.py` hook has a corresponding `*_test.sh` script that invokes each hook with various JSON inputs. Run `./test.sh` to test all hooks.

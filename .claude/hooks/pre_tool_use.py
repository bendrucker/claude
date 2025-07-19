"""
Pre-tool-use hook example for claude-hooks.
This hook can validate and potentially block tool execution.
"""

from claude_hooks import HookResult, PreToolUse, run_hooks


def log_event(event: PreToolUse) -> HookResult:
    return event.undefined()


if __name__ == "__main__":
    run_hooks(log_event)

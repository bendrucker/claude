"""
Stop hook example for claude-hooks.
This hook runs when Claude finishes a conversation.
"""

from claude_hooks import HookResult, Stop, run_hooks


def log_event(event: Stop) -> HookResult:
    return event.undefined()


if __name__ == "__main__":
    run_hooks(log_event)

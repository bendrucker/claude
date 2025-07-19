"""
Notification hook example for claude-hooks.
This hook responds to various Claude Code notifications.
"""

from claude_hooks import HookResult, Notification, run_hooks


def log_event(event: Notification) -> HookResult:
    return event.undefined()


if __name__ == "__main__":
    run_hooks(log_event)

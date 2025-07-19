"""
Pre-compact hook example for claude-hooks.
This hook runs before conversation compaction.
"""

from claude_hooks import HookResult, run_hooks
from claude_hooks.hook_utils import PreCompact


def log_event(event: PreCompact) -> HookResult:
    return event.undefined()


if __name__ == "__main__":
    run_hooks(log_event)

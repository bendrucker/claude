# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Hook**: Automatically injects planning guidelines when entering plan mode (via Shift+Tab or EnterPlanMode tool)
- **Hook**: Gates `ExitPlanMode`, denying byte-identical plan re-presents and asking once per session before presenting a plan over 12k characters

## How It Works

The `UserPromptSubmit` hook checks `permission_mode` in the hook input. When the mode is `plan`, it injects the planning guidelines into the conversation context. A marker file prevents duplicate injection on subsequent prompts within the same session.

The `PreToolUse` gate hook hashes each presented plan under `/tmp/claude/<session_id>/` and denies a resubmission whose text is unchanged since the last presentation, with instructions to revise instead of regrow. Plans over 12k characters trigger a one-time confirmation prompt. Infrastructure weirdness (missing session id, unreadable state) fails open.

## Testing

```sh
bun test plugins/plan
```

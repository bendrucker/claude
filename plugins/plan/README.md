# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Hook**: Automatically injects planning guidelines when entering plan mode (via Shift+Tab or EnterPlanMode tool)

## How It Works

The `UserPromptSubmit` hook checks `permission_mode` in the hook input. When the mode is `plan`, it injects the planning guidelines into the conversation context. A marker file prevents duplicate injection on subsequent prompts within the same session.

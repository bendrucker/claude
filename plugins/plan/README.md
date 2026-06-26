# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Hook**: Automatically injects planning guidelines when entering plan mode (via Shift+Tab or EnterPlanMode tool)
- **Skill**: `plan:guidelines` - Detailed planning best practices for when explicit guidance is needed
- **Scanner**: `scripts/alternatives-scan.ts` - Baseline structural scan of a plan corpus measuring how often roads-not-taken leak inline instead of into a dedicated Alternatives section
- **Eval**: `evals/` - Seeded A/B that measures whether a candidate guidance snippet changes how plans record declined alternatives

## How It Works

The `UserPromptSubmit` hook checks `permission_mode` in the hook input. When the mode is `plan`, it injects the planning guidelines into the conversation context. A marker file prevents duplicate injection on subsequent prompts within the same session.

## Testing

`bun test plugins/plan` runs the scanner and eval helper unit tests over synthetic fixtures.

The corpus scan and the A/B are local and manual. The corpus is local-only, and the A/B shells out to `claude -p`, so neither runs in CI:

- `bun plugins/plan/scripts/alternatives-scan.ts --dir ~/.claude/plans` prints the inline-leak rate over the local corpus. Add `--ssh <host>` to scan a remote corpus read-only.
- `bun plugins/plan/evals/ab.ts` runs the control-vs-treatment A/B. See [`evals/README.md`](evals/README.md).
